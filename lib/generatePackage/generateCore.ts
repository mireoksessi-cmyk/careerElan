import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logSafeError } from "@/lib/errors/publicError";
import {
  PACKAGE_GENERATION_MODEL,
  PACKAGE_PROMPT_VERSION,
} from "@/lib/config/aiModels";
import {
  buildCareerMemoryManifest,
  buildUploadedResumeManifest,
  extractJson,
  cleanDocumentText,
  validateDocumentQuality,
  normalizePackageAnalysis,
  validateSourceIntegrity,
  validateProtectedClaims,
  validateCanadianScope,
  validateRequirementEvidence,
  validateAnalysisLogic,
  warnCardDifferences,
  classifyGenerationError,
} from "@/lib/generatePackage/shared";

/*
  maxRetries: 0 for the same reason as before (see the historical note in
  git history on this constant) - a per-call `timeout` alone, without this,
  gets multiplied by the SDK's default retry count. Now that this call runs
  inside a Background Function (up to 15 minutes) instead of a synchronous
  Netlify Function (60s hard limit), the ceiling below is generous - it
  only needs to catch a genuinely hung request, not race a platform
  timeout. Real measured latency for this call has been ~49-57s; 120s
  leaves very wide margin above that while still failing well before the
  background function's own 15-minute limit.
*/
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 0,
});

const OPENAI_CALL_TIMEOUT_MS = 120_000;

/*
  Runs the actual AI generation for one already-claimed applications row.
  Performs its own atomic worker-claim first (UPDATE ... WHERE
  generation_status='pending' AND generation_worker_claimed_at IS NULL),
  so calling this twice for the same applicationId - e.g. a Background
  Function's platform-level retry after a transient failure - is safe: the
  second call's claim affects 0 rows and it returns immediately without
  ever calling OpenAI.

  Reads ONLY the applications row (via the service-role client, explicit
  id+status/claim filtering since RLS is bypassed) - never re-queries
  career_memory, resumes, or cover_letters. Every fact fed to the AI, and
  the entire fact-checking manifest, comes from the generation_input_*
  snapshot columns frozen at claim time by the synchronous route, so a
  user changing their Dashboard selection mid-generation, or a retry of
  the same generationRequestId, cannot change what gets generated.
*/
export async function runPackageGeneration(
  applicationId: string
): Promise<void> {
  const workerRequestId = crypto.randomUUID();

  const { data: claimedRows, error: claimError } = await supabaseAdmin
    .from("applications")
    .update({ generation_worker_claimed_at: new Date().toISOString() })
    .eq("id", applicationId)
    .eq("generation_status", "pending")
    .is("generation_worker_claimed_at", null)
    .select("*");

  if (claimError) {
    logSafeError(claimError, {
      requestId: workerRequestId,
      route: "generatePackage/generateCore#claim",
    });
    return;
  }

  const row = claimedRows?.[0];

  if (!row) {
    /*
      0 rows affected: either another invocation already claimed this
      applicationId (duplicate/retried worker call), or the row is no
      longer in a claimable state (already succeeded/failed). Either way,
      exiting silently here is correct - it's what makes worker-level
      duplicate execution safe.
    */
    return;
  }

  const userId: string = row.user_id;

  try {
    const resumeSource: "career_memory" | "upload" =
      row.resume_source === "uploaded" ? "career_memory" : row.resume_source;

    const resumeText: string = row.generation_input_resume_text || "";
    const title: string = row.job_title || "the position";
    const company: string = row.company || "the company";
    const jobText: string = row.job_description || "";
    const existingCoverLetter: string =
      row.generation_input_cover_letter_text || "";

    const manifest =
      row.resume_source === "career_memory"
        ? buildCareerMemoryManifest(
            row.generation_input_manifest_source,
            resumeText
          )
        : buildUploadedResumeManifest(row.generation_input_manifest_source);

    const aiResponse = await client.responses.create(
      {
        model: process.env.OPENAI_PACKAGE_MODEL || PACKAGE_GENERATION_MODEL,

        input: `
You are Career Élan's Canadian resume strategist, ATS specialist, recruiter, and application writer.

You must first analyze the complete job posting. Only after the job analysis is complete may you write the resume, cover letter, and application email.

==================================================
SINGLE FACTUAL SOURCE
==================================================

Resume source selected by the user:

${resumeSource}

The PRIMARY RESUME below is the only factual source.

If the source is career_memory:
- use only the Career Memory resume represented by the PRIMARY RESUME and SOURCE MANIFEST

If the source is upload:
- use only the selected uploaded resume represented by the PRIMARY RESUME and SOURCE MANIFEST

The job posting is not evidence about the candidate.

The existing cover letter is not a factual source. It may be used only as a tone and writing-style reference.

Do not use unselected resumes or unrelated Career Memory information.

Never invent:

- companies
- organizations
- employers
- job titles
- employment dates
- new responsibilities
- new work experience
- education
- degrees
- fields of study
- certifications
- licences
- registrations
- languages
- language proficiency
- software experience
- equipment experience
- technical experience
- numerical achievements
- citizenship
- permanent residence
- visas
- work permits
- work authorization
- security clearances
- regulated professional status

You may professionally rewrite a responsibility that already exists.

Example:

Source:
Answered phone inquiries.

Allowed:
Responded to client inquiries by phone and provided clear service guidance.

Not allowed:
Managed a national high-volume customer service centre.

Do not add a number unless the number appears in the PRIMARY RESUME.

==================================================
CAREER MEMORY OPTIONAL SECTIONS
==================================================

The SOURCE MANIFEST determines which sections actually exist.

A section exists only when its core identifying information is present.

If sectionPresence.education is false:
- do not create Education
- do not create Academic Background
- do not create Education and Training

If sectionPresence.languages is false:
- do not create Languages
- do not create Language Skills
- do not create Bilingual Skills

If sectionPresence.certifications is false:
- do not create Certifications
- do not create Certificates
- do not create Credentials
- do not create Licences

If sectionPresence.projects is false:
- do not create Projects
- do not create Project Experience

If sectionPresence.careerGoals is false:
- do not create Career Goals
- do not create Career Objective
- do not create Professional Objective
- do not create Target Role

If sectionPresence.volunteerExperience is false:
- do not create a separate Volunteer Experience section

A section may be partially completed.

Include only fields actually entered by the user.

Example:

Education:
- school: Seneca Polytechnic
- program: Law Clerk
- date: empty
- GPA: empty
- coursework: empty

Allowed:
Include Seneca Polytechnic and Law Clerk.

Not allowed:
Invent dates, GPA, coursework, awards, or graduation status.

Do not treat these as valid sections:

- Education containing only dates, GPA, or coursework with no school, program, degree, or field
- Language containing only "Fluent" with no language name
- Certification containing only issuer or date with no credential name
- Project containing only dates with no project name or meaningful description

A qualification mentioned by the user inside the source summary may remain in the summary.

A summary mention alone does not authorize creating a new separate section.

==================================================
JOB POSTING ANALYSIS — DO THIS FIRST
==================================================

Before writing, analyze:

- employer and sector
- main business need
- major responsibilities
- mandatory requirements
- preferred requirements
- required years of experience
- education and field-of-study requirements
- certifications
- licences
- regulated professional status
- security screening and clearance
- bilingual or multilingual requirements
- day shift
- evening shift
- night shift
- rotating shift
- weekend work
- holiday work
- driver's licence
- travel or mobility requirements
- required software
- required equipment
- technical skills
- repeated ATS keywords

Compare each important requirement to the PRIMARY RESUME and classify it as:

- supported
- partially_supported
- not_supported
- unclear

Transferable experience is not direct proof of a mandatory technical or professional requirement.

For supported or partially supported requirements:
- sourceEvidence must be a short phrase appearing in the PRIMARY RESUME
- source must be primary_resume

For not_supported or unclear requirements:
- sourceEvidence must be empty
- source must be none

==================================================
DOCUMENT WRITING
==================================================

RESUME

Return a complete plain-text resume.

Preserve every existing:

- applicant identity and contact information
- company
- organization
- employer
- job title
- date
- work-history entry
- volunteer-history entry
- education entry
- certification
- licence
- language entry
- project entry

Preserve the order of work and volunteer history.

You may:

- tailor the Professional Summary
- reorder skills
- reorder bullets within the same role
- rewrite existing work more professionally
- use truthful ATS keywords
- emphasize relevant duties
- reduce emphasis on unrelated duties

You may not:

- delete factual history
- move duties between employers
- merge separate roles
- change dates
- change job titles
- convert volunteer work into paid work
- add missing qualifications
- add missing shift experience
- add missing software or equipment experience

Do not output an empty section.

COVER LETTER

Write specifically for:

Position: ${title}
Company: ${company}

Connect the employer's main requirements to supported candidate experience.

When experience is transferable rather than direct, say so naturally.

Do not present transferable experience as direct industry experience.

Do not claim a missing mandatory qualification.

Do not copy the resume paragraph by paragraph.

EMAIL DRAFT

Keep the email concise.

Include:

- subject line
- greeting
- exact position title
- company name
- expression of interest
- reference to attached resume and cover letter
- professional closing
- applicant name

Do not load the email with unnecessary career facts.

==================================================
CANADIAN SCOPE
==================================================

Career Élan supports:

- Canadian private-sector postings
- Canadian provincial-government postings
- Canadian municipal or local-government postings

It does not support Canadian federal-government applications.

Classify the posting as:

- private
- provincial
- municipal
- federal
- unknown

If federal:
- sector must be federal
- supportedByCareerElan must be false

==================================================
REGULATED AND HIGH-RISK REQUIREMENTS
==================================================

Never state that the candidate has:

- citizenship
- permanent residence
- a work permit
- authorization to work
- security clearance
- professional registration
- a regulated licence

unless the PRIMARY RESUME explicitly supports it.

If a mandatory regulated licence is missing:
- licenceStatus must be missing
- matchLevel must not be strong
- applyRecommendation must not be recommended

If mandatory bilingual ability is not fully supported:
- do not call the candidate bilingual
- matchLevel must not be strong

If mandatory night, rotating, weekend, or holiday availability is required but the source does not confirm it:
- scheduleRequirement.candidateStatus must be not_supported or unclear
- include it in missingRequirements when important

==================================================
FOUR ANALYSIS CARDS
==================================================

Keep these four cards:

1. keyChanges
Explain the most meaningful tailoring changes.

The wording does not need to be exactly identical to the final resume.

2. mismatch
Show important mandatory or preferred requirements not confirmed by the source.

3. matches
Separate direct matches from realistic transferable skills.

4. recommendation
State whether the candidate should apply and list practical next steps.

Do not repeat the same point across every card.

==================================================
MATCH SCORE
==================================================

85–100:
strong

65–84:
moderate

40–64:
low

0–39:
critical_mismatch

Do not inflate the score.

A missing core licence, legal qualification, essential degree, or central professional requirement should normally result in low or critical_mismatch.

==================================================
OUTPUT
==================================================

Return only valid JSON.

Do not use markdown.
Do not use code fences.

Use exactly this structure:

{
  "resume": "Complete resume string",
  "coverLetter": "Complete cover letter string",
  "emailDraft": "Complete application email string",
  "packageAnalysis": {
    "overallMatch": 0,
    "matchLevel": "strong | moderate | low | critical_mismatch",
    "keyChanges": [
      {
        "section": "",
        "original": "",
        "revised": "",
        "reason": ""
      }
    ],
    "mismatch": {
      "summary": "",
      "missingRequirements": [],
      "unsupportedClaims": []
    },
    "matches": {
      "strongMatches": [],
      "transferableSkills": []
    },
    "recommendation": {
      "summary": "",
      "applyRecommendation": "recommended | consider | not_recommended",
      "nextSteps": []
    },
    "verification": {
      "jobContext": {
        "country": "Canada | Unknown",
        "sector": "private | provincial | municipal | federal | unknown",
        "province": "",
        "municipality": "",
        "supportedByCareerElan": true,
        "classificationReason": ""
      },
      "requirements": [
        {
          "requirement": "",
          "category": "mandatory | preferred | legal_or_regulated",
          "evidenceStatus": "supported | partially_supported | not_supported | unclear",
          "sourceEvidence": "",
          "source": "primary_resume | none",
          "regulated": false
        }
      ],
      "regulatedRole": {
        "isRegulated": false,
        "profession": "",
        "jurisdiction": "",
        "requiredLicence": "",
        "licenceEvidence": "",
        "licenceStatus": "verified | missing | not_required | unclear"
      },
      "bilingualRequirement": {
        "level": "mandatory | preferred | not_required | unclear",
        "languages": [],
        "evidence": "",
        "status": "verified | partially_verified | missing | not_required | unclear"
      },
      "scheduleRequirement": {
        "dayShift": false,
        "eveningShift": false,
        "nightShift": false,
        "rotatingShift": false,
        "weekendWork": false,
        "holidayWork": false,
        "requirementLevel": "mandatory | preferred | not_required | unclear",
        "candidateStatus": "supported | partially_supported | not_supported | unclear",
        "explanation": ""
      }
    }
  }
}

Limits:

- keyChanges: maximum 4
- missingRequirements: maximum 5
- unsupportedClaims: maximum 4
- strongMatches: maximum 5
- transferableSkills: maximum 4
- nextSteps: maximum 3
- requirements: maximum 20

==================================================
SOURCE MANIFEST
==================================================

${JSON.stringify(
  /*
    originalText is deliberately omitted here - it's the exact same
    string as the PRIMARY RESUME block below, and including it in both
    places sent the full resume text to the model twice. The full
    manifest object (with originalText intact) is still used as-is for
    the post-generation fact-checking validators further down - only
    this prompt-facing copy excludes it.
  */
  { ...manifest, originalText: undefined },
  null,
  2
)}

==================================================
PRIMARY RESUME — ONLY FACTUAL SOURCE
==================================================

${resumeText}

==================================================
EXISTING COVER LETTER — STYLE REFERENCE ONLY
==================================================

${existingCoverLetter}

==================================================
COMPLETE JOB DESCRIPTION
==================================================

${jobText}
`,
      },
      { timeout: OPENAI_CALL_TIMEOUT_MS, maxRetries: 0 }
    );

    const rawPackage = extractJson(aiResponse.output_text);

    if (
      typeof rawPackage.resume !== "string" ||
      typeof rawPackage.coverLetter !== "string" ||
      typeof rawPackage.emailDraft !== "string"
    ) {
      throw new Error(
        "The AI returned one or more documents in an invalid format."
      );
    }

    const resume = cleanDocumentText(rawPackage.resume);
    const coverLetter = cleanDocumentText(rawPackage.coverLetter);
    const emailDraft = cleanDocumentText(rawPackage.emailDraft);

    validateDocumentQuality("Resume", resume);
    validateDocumentQuality("Cover Letter", coverLetter);
    validateDocumentQuality("Email Draft", emailDraft);

    const packageAnalysis = normalizePackageAnalysis(
      rawPackage.packageAnalysis
    );

    const documents = { resume, coverLetter, emailDraft };

    /*
      선택한 원본만 검증 기준으로 사용한다.
    */
    const sourceText = manifest.originalText;

    validateSourceIntegrity(resume, manifest);
    validateProtectedClaims(documents, sourceText);
    validateCanadianScope(packageAnalysis.verification);
    validateRequirementEvidence(packageAnalysis.verification, sourceText);
    validateAnalysisLogic(packageAnalysis);
    warnCardDifferences(packageAnalysis);

    await supabaseAdmin
      .from("applications")
      .update({
        generation_status: "succeeded",
        resume_text: resume,
        cover_letter_text: coverLetter,
        email_draft: emailDraft,
        ai_insight: packageAnalysis,
        generation_model:
          process.env.OPENAI_PACKAGE_MODEL || PACKAGE_GENERATION_MODEL,
        prompt_version: PACKAGE_PROMPT_VERSION,
        generation_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", applicationId)
      .eq("user_id", userId);
  } catch (error) {
    const { code, summary } = classifyGenerationError(error);

    try {
      await supabaseAdmin
        .from("applications")
        .update({
          generation_status: "failed",
          generation_error_code: code,
          generation_error_summary: summary,
          generation_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", applicationId)
        .eq("user_id", userId);
    } catch {
      /*
        Best-effort only - a failure to mark this row as failed must never
        mask or replace the original error being logged below.
      */
    }

    logSafeError(error, {
      requestId: workerRequestId,
      route: "generatePackage/generateCore#generate",
      userId,
      generationRequestId: row.generation_request_id,
    });
  }
}
