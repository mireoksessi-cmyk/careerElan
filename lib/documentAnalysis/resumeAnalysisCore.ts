import OpenAI from "openai";
import { supabaseAdmin } from "../supabaseAdmin";
import { logSafeError } from "../errors/publicError";
import { RESUME_PARSE_DRAFT_MODEL, RESUME_PARSE_MODEL } from "../config/aiModels";
import { classifyGenerationError } from "./shared";
import { isE2eAiModeActive, wrapOpenAiClientForE2eSafety } from "../testing/e2eAiIsolation";
import { buildE2eResumeAnalysisFields } from "../testing/e2eFakeResponses";
import { logOperationalEvent, elapsedMs } from "../observability/logger";
import { withOpenAiTelemetry } from "../openai/telemetry";
import {
  RESUME_ALLOWED_EXTENSIONS,
  UploadValidationError,
  assertAllowedExtension,
  assertDocxSignature,
  assertPdfSignature,
  assertWithinSizeLimit,
  classifyPdfParseError,
  hasMeaningfulText,
  withParseTimeout,
} from "./uploadValidation";

// Part N mitigation - see uploadValidation.ts's withParseTimeout docstring for
// why this is a wall-clock bound, not a full zip-bomb resource limit.
const DOCX_PARSE_TIMEOUT_MS = 30_000;

/*
  Resume analysis worker - the actual text extraction + 3 sequential
  OpenAI calls. Now invoked directly and awaited in-process by
  app/api/analyze-resume/route.ts (Next.js Route runtime), not by a
  Netlify classic Background Function - production DB evidence proved
  pdf-parse-new fails to load in that bundler, which (unlike the Next.js
  Runtime) next.config.js's serverExternalPackages does not cover. See
  app/api/analyze-resume/route.ts's own top comment for the full history.

  pdf-parse-new and mammoth are still deliberately NOT imported at module
  top level, even though this now runs in a runtime where the static
  import would work - this keeps a load failure caught by the existing
  try/catch and turned into a correctly-terminated 'failed' status rather
  than an uncaught module-load exception, matching
  app/api/process-resume-design/route.ts's own documented convention.
*/

const client = wrapOpenAiClientForE2eSafety(
  new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 0,
  })
);

// Same reasoning as lib/generatePackage/generateCore.ts's own
// OPENAI_CALL_TIMEOUT_MS: this now runs inside a Background Function (up to
// 15 minutes), not the ~26s-class Netlify gateway window the old in-request
// call was silently being killed by - 120s sits comfortably above observed
// real latency while still failing well short of the background limit if
// something is genuinely hung.
const OPENAI_CALL_TIMEOUT_MS = 120_000;

function normalizeSkills(data: any) {
  if (!data) return "";

  if (Array.isArray(data)) {
    return [
      ...new Set(
        data
          .map((x: any) => (typeof x === "string" ? x : x.name || x.skill || ""))
          .filter(Boolean)
      ),
    ].join(", ");
  }

  return String(data)
    .replace(/([a-z])([A-Z])/g, "$1, $2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeLanguages(data: any) {
  if (!Array.isArray(data)) return [];

  return data.map((x: any) => {
    if (typeof x === "string") {
      return { language: x, proficiency: "" };
    }

    return {
      language: x.language || x.name || "",
      proficiency: x.proficiency || x.level || "",
    };
  });
}

function normalizeEducation(data: any) {
  if (!Array.isArray(data)) return [];

  return data.map((x: any) => ({
    school: x.school || "",
    program: x.program || x.degree || "",
    dates:
      x.dates ||
      `${x.startDate || ""}${x.startDate && x.endDate ? " - " : ""}${x.endDate || ""}`,
    gpa: x.gpa || "",
    coursework: x.description || x.coursework || "",
  }));
}

function normalizeWork(data: any) {
  if (!Array.isArray(data)) return [];

  return data.map((x: any) => ({
    company: x.company || "",
    jobTitle: x.jobTitle || x.position || x.title || x.role || "",
    dates:
      x.dates ||
      `${x.startDate || ""}${x.startDate && x.endDate ? " - " : ""}${x.endDate || ""}`,
    description: x.description || "",
  }));
}

function normalizeVolunteer(data: any) {
  if (!Array.isArray(data)) return [];

  return data.map((x: any) => ({
    organization: x.organization || x.company || "",
    role: x.role || x.position || x.title || "",
    dates:
      x.dates ||
      `${x.startDate || ""}${x.startDate && x.endDate ? " - " : ""}${x.endDate || ""}`,
    description: x.description || "",
  }));
}

function normalizeCertifications(data: any) {
  if (!Array.isArray(data)) return [];

  return data.map((x: any) => ({
    name: typeof x === "string" ? x : x.name || "",
    issuer: typeof x === "string" ? "" : x.issuer || "",
    date: typeof x === "string" ? "" : x.date || "",
  }));
}

function normalizeProjects(data: any) {
  if (!Array.isArray(data)) return [];

  return data.map((x: any) => ({
    name: x.name || "",
    description: x.description || "",
    technologies: x.technologies || "",
    link: x.link || "",
  }));
}

/*
  Unlike the pre-Phase-6I.6.32 version, parser exceptions are no longer
  swallowed into an empty string - a corrupt/encrypted PDF must be
  classified distinctly from a valid-but-sparse PDF (Parts I/J), which
  requires the caller to see the real thrown error.
*/
async function extractPdfText(
  buffer: Buffer,
  pdf: (buffer: Buffer) => Promise<{ text?: string }>
) {
  const parsed = await pdf(buffer);
  return parsed.text || "";
}

class AnalysisFailure extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function setStage(resumeId: string, userId: string, stage: string) {
  try {
    const { error } = await supabaseAdmin.rpc("update_resume_analysis_stage", {
      p_resume_id: resumeId,
      p_user_id: userId,
      p_stage: stage,
    });

    if (error) {
      logSafeError(error, {
        requestId: resumeId,
        route: "documentAnalysis/resumeAnalysisCore#stage",
        userId,
      });
    }
  } catch (error) {
    logSafeError(error, {
      requestId: resumeId,
      route: "documentAnalysis/resumeAnalysisCore#stage",
      userId,
    });
  }
}

/*
  Runs the actual text extraction + AI analysis for one already-inserted
  resumes row. Performs its own atomic worker-claim first (UPDATE ... WHERE
  analysis_status = 'pending'), so calling this twice for the same
  resumeId - a platform-level retry of a failed/timed-out Background
  Function invocation, or the local-dev stand-in route being hit twice - is
  safe: the second call's claim affects 0 rows and it returns immediately
  without ever calling OpenAI.
*/
export async function runResumeAnalysis(resumeId: string): Promise<void> {
  const { data: claimedRows, error: claimError } = await supabaseAdmin.rpc(
    "claim_resume_analysis_worker",
    { p_resume_id: resumeId }
  );

  if (claimError) {
    logSafeError(claimError, {
      requestId: resumeId,
      route: "documentAnalysis/resumeAnalysisCore#claim",
    });
    return;
  }

  const row = claimedRows?.[0];

  if (!row) {
    // Already claimed/resolved by another invocation - safe no-op.
    return;
  }

  const userId: string = row.user_id;
  const fileName: string = row.file_name || "";
  const storagePath: string = row.storage_path;
  const startedAt = Date.now();

  try {
    await setStage(resumeId, userId, "downloading_file");

    const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
      .from("resumes")
      .download(storagePath);

    if (downloadError || !fileBlob) {
      if (downloadError) {
        logSafeError(downloadError, { requestId: resumeId, route: "documentAnalysis/resumeAnalysisCore#download", userId });
      }

      throw new AnalysisFailure(
        "STORAGE_DOWNLOAD_FAILED",
        "The uploaded file could not be retrieved."
      );
    }

    const buffer = Buffer.from(await fileBlob.arrayBuffer());

    // Parts E/F/G - server-side authoritative checks, independent of
    // whatever the client already claimed at upload time: real size/
    // zero-byte enforcement, and the extension is only ever used to select
    // which magic-byte signature to check next, never to skip that check.
    let extension: string;

    try {
      assertWithinSizeLimit(buffer.length);
      extension = assertAllowedExtension(fileName, RESUME_ALLOWED_EXTENSIONS);
    } catch (validationError) {
      if (validationError instanceof UploadValidationError) {
        throw new AnalysisFailure(validationError.code, validationError.message);
      }
      throw validationError;
    }

    await setStage(resumeId, userId, "extracting_text");

    let resumeText = "";

    if (extension === "pdf") {
      try {
        assertPdfSignature(buffer);
      } catch (validationError) {
        if (validationError instanceof UploadValidationError) {
          throw new AnalysisFailure(validationError.code, validationError.message);
        }
        throw validationError;
      }

      let pdf: (buffer: Buffer) => Promise<{ text?: string }>;

      try {
        pdf = (await import("pdf-parse-new")).default;
      } catch (importError) {
        logSafeError(importError, { requestId: resumeId, route: "documentAnalysis/resumeAnalysisCore#pdf-parse-load", userId });
        throw new AnalysisFailure(
          "MODULE_LOAD_FAILED",
          "We couldn't process this resume. Please try again."
        );
      }

      try {
        resumeText = await extractPdfText(buffer, pdf);
      } catch (parseError) {
        const code = classifyPdfParseError(parseError);
        throw new AnalysisFailure(
          code,
          code === "ENCRYPTED_PDF"
            ? "This PDF is password-protected. Please upload an unlocked copy."
            : "We couldn't read this resume file. Please try exporting it again."
        );
      }

      if (!hasMeaningfulText(resumeText)) {
        throw new AnalysisFailure(
          "NO_READABLE_TEXT",
          "We couldn't find readable text in this PDF. Please upload a text-based PDF or DOCX resume."
        );
      }
    } else if (extension === "docx") {
      try {
        assertDocxSignature(buffer);
      } catch (validationError) {
        if (validationError instanceof UploadValidationError) {
          throw new AnalysisFailure(validationError.code, validationError.message);
        }
        throw validationError;
      }

      let mammoth: { extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }> };

      try {
        mammoth = await import("mammoth");
      } catch (importError) {
        logSafeError(importError, { requestId: resumeId, route: "documentAnalysis/resumeAnalysisCore#mammoth-load", userId });
        throw new AnalysisFailure(
          "MODULE_LOAD_FAILED",
          "We couldn't process this resume. Please try again."
        );
      }

      try {
        const doc = await withParseTimeout(
          mammoth.extractRawText({ buffer }),
          DOCX_PARSE_TIMEOUT_MS,
          "CORRUPT_DOCX",
          "We couldn't read this resume file. Please try exporting it again."
        );
        resumeText = doc.value;
      } catch (parseError) {
        if (parseError instanceof UploadValidationError) {
          throw new AnalysisFailure(parseError.code, parseError.message);
        }
        throw new AnalysisFailure(
          "CORRUPT_DOCX",
          "We couldn't read this resume file. Please try exporting it again."
        );
      }

      if (!hasMeaningfulText(resumeText)) {
        throw new AnalysisFailure(
          "NO_READABLE_TEXT",
          "We couldn't find readable text in this file. Please upload a text-based PDF or DOCX resume."
        );
      }
    }

    if (!resumeText.trim()) {
      throw new AnalysisFailure("NO_TEXT_FOUND", "No readable text found in resume.");
    }

    resumeText = resumeText
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    /*
      Phase 6I.6.35 - E2E AI isolation: real text extraction/validation
      above (Storage download, PDF/DOCX parsing, empty-text check) still
      runs unchanged - only the 3 sequential OpenAI calls below (OCR
      cleanup, field extraction, verification) are replaced with one
      deterministic synthetic result when isE2eAiModeActive(), then the
      SAME complete_resume_analysis RPC persistence path runs as a real
      analysis would use.
    */
    if (isE2eAiModeActive()) {
      const parsed = buildE2eResumeAnalysisFields();
      await setStage(resumeId, userId, "verifying");
      const finalData = { ...parsed, originalText: resumeText };
      const { error: e2eCompleteError } = await supabaseAdmin.rpc("complete_resume_analysis", {
        p_resume_id: resumeId,
        p_user_id: userId,
        p_parsed_data: finalData,
        p_original_text: resumeText,
      });
      if (e2eCompleteError) {
        logSafeError(e2eCompleteError, { requestId: resumeId, route: "documentAnalysis/resumeAnalysisCore#e2e-complete", userId });
      }
      return;
    }

    await setStage(resumeId, userId, "reconstructing_text");

    const cleanedResume = await withOpenAiTelemetry(
      { operation: "RESUME_ANALYSIS", model: RESUME_PARSE_DRAFT_MODEL, retryCount: 0, userId },
      () =>
        client.chat.completions.create(
          {
            model: RESUME_PARSE_DRAFT_MODEL,
            temperature: 0,
            messages: [
              {
                role: "system",
                content: `
You are an expert resume reconstruction engine.

Your job is NOT to summarize.

Your job is to rebuild the resume exactly as a human would type it.

Rules:

1. Never invent information.
2. Never delete information.
3. Restore all section headings.
4. Restore proper line breaks.
5. Restore bullet points using "- ".
6. Put every responsibility on its own line.
7. Put every job into this format:

Job Title
Dates
Company

- bullet
- bullet
- bullet

8. Put every education entry into this format:

Degree
School
Dates

9. Restore skills into a comma-separated list.

10. Preserve emails, phone numbers and LinkedIn exactly.

11. If OCR merged sentences together, split them naturally.

12. If text order looks wrong, rearrange it logically.

13. Never output JSON.

Output only the reconstructed resume.
      `,
          },
              {
                role: "user",
                content: resumeText,
              },
            ],
          },
          { timeout: OPENAI_CALL_TIMEOUT_MS, maxRetries: 0 }
        )
    );

    resumeText = cleanedResume.choices[0].message.content || resumeText;

    const numberedResume = resumeText
      .split("\n")
      .map((line, i) => `${i + 1}. ${line}`)
      .join("\n");

    const prompt = `
You are an expert resume parser.

Your task is to extract structured information from the resume.

Return ONLY valid JSON.

The resume may have ANY layout.

Do NOT rely on section headings.

The resume may not contain headings like:
- Skills
- Work Experience
- Education
- Languages
- Certifications
- Projects

Instead, infer each piece of information from context.

Rules:

- Extract ALL information from the resume.
- Never invent information.
- Never discard information.
- Never summarize work experience.
- Never rewrite sentences.
- Preserve all skills.
- Preserve all education.
- Preserve all work experience.
- Preserve all volunteer experience.
- Preserve all certifications.
- Preserve all projects.

If multiple responsibilities exist,
combine them into ONE description separated by newline characters.

Never leave description empty if responsibilities exist.

If a company and job title exist,
create a workExperience object even if dates are missing.

If a school and degree exist,
create an education object even if dates are missing.

If dates are missing,
return an empty string.

Never output placeholders such as:

- "Dates"
- "Location"
- "Experience details"
- "Description here"

Return ONLY valid JSON.

JSON format:

{
  "firstName":"",
  "lastName":"",
  "email":"",
  "phone":"",
  "location":"",
  "linkedin":"",
  "headline":"",
  "summary":"",
  "skills":[
    ""
  ],
  "education":[
    {
      "school":"",
      "program":"",
      "dates":"",
      "gpa":"",
      "coursework":""
    }
  ],
  "workExperience":[
    {
      "company":"",
      "jobTitle":"",
      "dates":"",
      "description":""
    }
  ],
  "volunteerExperience":[
    {
      "organization":"",
      "role":"",
      "dates":"",
      "description":""
    }
  ],
  "languages":[
    {
      "language":"",
      "proficiency":""
    }
  ],
  "certifications":[
    {
      "name":"",
      "issuer":"",
      "date":""
    }
  ],
  "projects":[
    {
      "name":"",
      "description":"",
      "technologies":"",
      "link":""
    }
  ]
}

Resume:

${numberedResume}
`;

    await setStage(resumeId, userId, "extracting_fields");

    const completion = await withOpenAiTelemetry(
      { operation: "RESUME_ANALYSIS", model: RESUME_PARSE_MODEL, retryCount: 0, userId },
      () =>
        client.chat.completions.create(
          {
            model: RESUME_PARSE_MODEL,
            temperature: 0,
            messages: [
              {
                role: "system",
                content: "You extract resume information. Respond ONLY with valid JSON.",
              },
              { role: "user", content: prompt },
            ],
          },
          { timeout: OPENAI_CALL_TIMEOUT_MS, maxRetries: 0 }
        )
    );

    const content = completion.choices[0].message.content || "{}";

    let parsed = JSON.parse(content);

    parsed.skills = normalizeSkills(parsed.skills);
    parsed.languages = normalizeLanguages(parsed.languages);
    parsed.education = normalizeEducation(parsed.education);
    parsed.workExperience = normalizeWork(parsed.workExperience);
    parsed.volunteerExperience = normalizeVolunteer(parsed.volunteerExperience);
    parsed.certifications = normalizeCertifications(parsed.certifications);
    parsed.projects = normalizeProjects(parsed.projects);

    await setStage(resumeId, userId, "verifying");

    const verify = await withOpenAiTelemetry(
      { operation: "RESUME_ANALYSIS", model: RESUME_PARSE_DRAFT_MODEL, retryCount: 0, userId },
      () =>
        client.chat.completions.create(
          {
            model: RESUME_PARSE_DRAFT_MODEL,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
          {
            role: "system",
            content: `
You verify resume JSON.

Never invent information.

Only correct obvious OCR mistakes.

Remove duplicate skills.

Remove placeholder text.

If email obviously contains OCR mistakes
(example: gmall.com -> gmail.com)
correct it.

Never change facts.

Return ONLY valid JSON.
`,
          },
          {
            role: "user",
            content: `
Original Resume:

${numberedResume}

Parsed JSON:

${JSON.stringify(parsed, null, 2)}

Compare the original resume with the parsed JSON.

Correct only obvious extraction mistakes.

Do not invent information.

Return ONLY valid JSON.
`,
              },
            ],
          },
          { timeout: OPENAI_CALL_TIMEOUT_MS, maxRetries: 0 }
        )
    );

    parsed = JSON.parse(verify.choices[0].message.content || "{}");

    parsed.skills = normalizeSkills(parsed.skills);
    parsed.languages = normalizeLanguages(parsed.languages);
    parsed.education = normalizeEducation(parsed.education);
    parsed.workExperience = normalizeWork(parsed.workExperience);
    parsed.volunteerExperience = normalizeVolunteer(parsed.volunteerExperience);
    parsed.certifications = normalizeCertifications(parsed.certifications);
    parsed.projects = normalizeProjects(parsed.projects);

    const finalData = {
      firstName: parsed.firstName || "",
      lastName: parsed.lastName || "",
      email: parsed.email || "",
      phone: parsed.phone || "",
      location: parsed.location || "",
      linkedin: parsed.linkedin || "",
      headline: parsed.headline || "",
      summary: parsed.summary || "",
      skills: parsed.skills || [],
      education: parsed.education || [],
      workExperience: parsed.workExperience || [],
      volunteerExperience: parsed.volunteerExperience || [],
      languages: parsed.languages || [],
      certifications: parsed.certifications || [],
      projects: parsed.projects || [],
      originalText: resumeText,
    };

    const { error: completeError } = await supabaseAdmin.rpc("complete_resume_analysis", {
      p_resume_id: resumeId,
      p_user_id: userId,
      p_parsed_data: finalData,
      p_original_text: resumeText,
    });

    if (completeError) {
      logSafeError(completeError, {
        requestId: resumeId,
        route: "documentAnalysis/resumeAnalysisCore#complete",
        userId,
      });
    }

    logOperationalEvent({ domain: "upload", event: "resume_analysis_succeeded", userId, resumeId, latencyMs: elapsedMs(startedAt) });
  } catch (error) {
    const { code, summary } =
      error instanceof AnalysisFailure
        ? { code: error.code, summary: error.message }
        : classifyGenerationError(error);

    logSafeError(error, {
      requestId: resumeId,
      route: "documentAnalysis/resumeAnalysisCore",
      userId,
    });

    logOperationalEvent({ domain: "upload", event: "resume_analysis_failed", userId, resumeId, errorCode: code, latencyMs: elapsedMs(startedAt) });

    const { error: failError } = await supabaseAdmin.rpc("fail_resume_analysis", {
      p_resume_id: resumeId,
      p_user_id: userId,
      p_error_code: code,
      p_error_summary: summary,
    });

    if (failError) {
      logSafeError(failError, {
        requestId: resumeId,
        route: "documentAnalysis/resumeAnalysisCore#fail",
        userId,
      });
    }
  }
}
