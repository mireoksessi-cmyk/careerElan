import OpenAI from "openai";
import { supabaseAdmin } from "../supabaseAdmin";
import { logSafeError } from "../errors/publicError";
import {
  PACKAGE_GENERATION_MODEL,
  PACKAGE_PROMPT_VERSION,
} from "../config/aiModels";
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
} from "./shared";

/*
  Deliberately relative imports throughout this file (and everything it
  imports from ./shared, ../supabaseAdmin, ../errors/publicError,
  ../config/aiModels - all already free of any local path-alias import,
  confirmed by direct inspection before this file was written) rather than
  the "@/..." alias used everywhere else in this codebase. This module is
  imported directly by netlify/functions/generate-package-background.ts,
  whose bundler is a separate build step from `next build` and is not
  confirmed to resolve tsconfig.json's custom path alias the same way
  Next.js does - relative imports remove that risk entirely rather than
  hoping the alias happens to work.
*/

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 0,
});

/*
  This call now runs inside a Background Function (Netlify: up to 15
  minutes; local-dev stand-in: bounded only by the long-lived `next start`
  process), not the 60s-capped synchronous Netlify Function the old
  in-request OpenAI call used to run in - so the old OPENAI_CALL_TIMEOUT_MS
  = 60_000 (sized around a 90s *client* timeout that no longer applies
  here) is replaced with a wider ceiling. 120s sits comfortably above
  observed real latency (~26-31s locally, up to ~55s reported from
  Production in earlier investigation) while still failing well short of
  the background execution limit if something is genuinely hung.
*/
const OPENAI_CALL_TIMEOUT_MS = 120_000;

/*
  Runs the actual AI generation for one already-claimed applications row.
  Performs its own atomic worker-claim first (UPDATE ... WHERE
  generation_status = 'pending' AND generation_worker_claimed_at IS NULL),
  so calling this twice for the same applicationId - e.g. a platform-level
  retry of a failed/timed-out Background Function invocation, or the
  local-dev stand-in route being hit twice - is safe: the second call's
  claim affects 0 rows and it returns immediately without ever calling
  OpenAI.

  Reads ONLY the applications row (via the service-role client, explicit
  id + generation_status + generation_worker_claimed_at filtering, since
  RLS is bypassed by design here) - never re-queries career_memory,
  resumes, or cover_letters. Every fact fed to the AI, and the entire
  fact-checking manifest, comes from the generation_input_* snapshot
  columns frozen at claim time by the synchronous route (see its own
  docstring), so a user changing their Dashboard selection mid-generation,
  or a retry of the same generationRequestId, cannot silently change what
  gets generated. "Ownership" of this row was already enforced once, by
  the authenticated (RLS-scoped) sync route at claim time; this function
  has no separate caller identity to check against - user_id on the
  already-claimed row is trusted as-is.
*/
export async function runPackageGeneration(
  applicationId: string
): Promise<void> {
  const workerRequestId = crypto.randomUUID();

  console.log(
    `GP WORKER CLAIM START workerRequestId=${workerRequestId} applicationId=${applicationId}`
  );

  /*
    Via RPC, not a direct .from("applications").update(...) - service_role
    has no direct table GRANT on applications in this project (see the
    claim_generate_package_worker migration's own comment for why: every
    application table here is either RLS-scoped-client-only or, like
    generate_package_usage, RPC-only for service_role - there is no
    "service_role can read/write applications directly" path). This
    SECURITY DEFINER function performs the exact same atomic UPDATE ...
    WHERE generation_status='pending' AND generation_worker_claimed_at IS
    NULL RETURNING * this worker used to run directly.
  */
  const { data: claimedRows, error: claimError } = await supabaseAdmin.rpc(
    "claim_generate_package_worker",
    { p_application_id: applicationId }
  );

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
      applicationId (duplicate/retried worker call - the exact scenario
      this claim exists to make safe), or the row is no longer in a
      claimable state (already succeeded/failed). Either way, exiting
      silently here is correct - it is what makes worker-level duplicate
      execution safe without ever calling OpenAI a second time.
    */
    console.log(
      `GP WORKER CLAIM MISS workerRequestId=${workerRequestId} applicationId=${applicationId}`
    );
    return;
  }

  console.log(
    `GP WORKER CLAIM OK workerRequestId=${workerRequestId} applicationId=${applicationId}`
  );

  const userId: string = row.user_id;
  const generationRequestId: string | null = row.generation_request_id;

  try {
    const resumeText: string = row.generation_input_resume_text || "";
    const jobText: string = row.job_description || "";

    /*
      Defensive input validation - the sync route already guarantees both
      of these are non-empty before ever claiming a row, but the worker
      treats its own input as untrusted rather than assuming the snapshot
      is always well-formed (e.g. a future bug in the sync route, or a
      row manually edited in the database).
    */
    if (!resumeText.trim() || !jobText.trim()) {
      throw new Error(
        "The generation input snapshot is missing required resume or job description text."
      );
    }

    const resumeSource: "career_memory" | "upload" =
      row.resume_source === "uploaded" ? "upload" : "career_memory";

    const title: string = row.job_title || "the position";
    const company: string = row.company || "the company";
    const analysis: unknown = row.job_analysis || {};
    const existingCoverLetter: string =
      row.generation_input_cover_letter_text || "";

    const manifest =
      row.resume_source === "career_memory"
        ? buildCareerMemoryManifest(
            row.generation_input_manifest_source,
            resumeText
          )
        : buildUploadedResumeManifest(
            row.generation_input_manifest_source
          );

    console.log(
      `GP WORKER OPENAI START workerRequestId=${workerRequestId} applicationId=${applicationId}`
    );
    const aiResponse = await client.responses.create(
      {
        model:
          process.env.OPENAI_PACKAGE_MODEL || PACKAGE_GENERATION_MODEL,

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
  manifest,
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
PREVIOUS JOB ANALYSIS — REFERENCE ONLY
==================================================

${JSON.stringify(
  analysis,
  null,
  2
)}

==================================================
COMPLETE JOB DESCRIPTION
==================================================

${jobText}
`,
      },
      { timeout: OPENAI_CALL_TIMEOUT_MS, maxRetries: 0 }
    );
    console.log(
      `GP WORKER OPENAI END workerRequestId=${workerRequestId} applicationId=${applicationId}`
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

    console.log(
      `GP WORKER DB UPDATE START workerRequestId=${workerRequestId} applicationId=${applicationId}`
    );
    // Via RPC - see claim_generate_package_worker's migration comment for
    // why service_role cannot write applications directly.
    const { error: completeWriteError } = await supabaseAdmin.rpc(
      "complete_generate_package_generation",
      {
        p_application_id: applicationId,
        p_user_id: userId,
        p_resume_text: resume,
        p_cover_letter_text: coverLetter,
        p_email_draft: emailDraft,
        p_ai_insight: packageAnalysis,
        p_generation_model:
          process.env.OPENAI_PACKAGE_MODEL || PACKAGE_GENERATION_MODEL,
        p_prompt_version: PACKAGE_PROMPT_VERSION,
      }
    );

    if (completeWriteError) {
      throw completeWriteError;
    }
    console.log(
      `GP WORKER DB UPDATE END workerRequestId=${workerRequestId} applicationId=${applicationId}`
    );

    /*
      Best-effort, retried, but deliberately NOT "fail closed" the way the
      old synchronous route had to be: there is no HTTP caller left
      waiting to receive an error and decide whether to retry. Instead,
      durability comes from two things that are both already true the
      moment generation_status flips to 'succeeded' above: (1) the result
      itself is already durably saved on the applications row regardless
      of whether this RPC ever succeeds, and (2)
      reserve_generate_package_usage()/get_generate_package_usage()'s own
      reconcile step (see supabase/migrations/
      20260725171800_generate_package_quota_state_reclaim.sql) already
      self-heals any 'reserved' row whose linked application has
      generation_status = 'succeeded' into 'completed' on the very next
      call either function receives for this user - including the next
      time the Dashboard's AI Usage widget polls
      /api/generate-package/usage. A failure here is therefore never a
      silent free generation; it's logged and left to that self-healing
      path.
    */
    if (generationRequestId) {
      console.log(
        `GP WORKER QUOTA COMPLETE START workerRequestId=${workerRequestId} applicationId=${applicationId}`
      );
      let completeError = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabaseAdmin.rpc(
          "complete_generate_package_usage",
          {
            p_user_id: userId,
            p_request_id: generationRequestId,
          }
        );

        completeError = error;

        if (!completeError) {
          break;
        }

        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      if (completeError) {
        logSafeError(completeError, {
          requestId: workerRequestId,
          route: "generatePackage/generateCore#quota-complete",
          userId,
          generationRequestId,
        });
      } else {
        console.log(
          `GP WORKER QUOTA COMPLETE END workerRequestId=${workerRequestId} applicationId=${applicationId}`
        );
      }
    }
  } catch (error) {
    const caughtErrorName =
      error instanceof Error ? error.name : typeof error;
    console.log(
      `GP WORKER CAUGHT ERROR workerRequestId=${workerRequestId} applicationId=${applicationId} name=${caughtErrorName}`
    );

    const { code, summary } = classifyGenerationError(error);

    try {
      // Via RPC - see claim_generate_package_worker's migration comment for
      // why service_role cannot write applications directly.
      await supabaseAdmin.rpc("fail_generate_package_generation", {
        p_application_id: applicationId,
        p_user_id: userId,
        p_error_code: code,
        p_error_summary: summary,
      });
    } catch {
      /*
        Best-effort only - a failure to mark this row as failed must never
        mask or replace the original error being logged below.
      */
    }

    if (generationRequestId) {
      try {
        /*
          Best-effort, single attempt (unlike the retried quota-complete
          call above) - matches the old synchronous route's own catch-block
          behavior. A failure here still self-heals: reserve_generate_
          package_usage()'s reconcile step marks a 'reserved' row 'released'
          once it sees generation_status = 'failed' on the linked
          application, on the very next reserve/get call for this user.
        */
        await supabaseAdmin.rpc("release_generate_package_usage", {
          p_user_id: userId,
          p_request_id: generationRequestId,
        });
      } catch {
        /*
          Best-effort only - must never mask the original error logged
          below.
        */
      }
    }

    logSafeError(error, {
      requestId: workerRequestId,
      route: "generatePackage/generateCore#generate",
      userId,
      generationRequestId: generationRequestId ?? undefined,
    });
  }
}
