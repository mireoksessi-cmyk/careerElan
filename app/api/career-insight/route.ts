import OpenAI from "openai";
import { NextResponse } from "next/server";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type CareerInsight = {
  mismatch: {
    summary: string;
    missingRequirements: string[];
    unsupportedClaims: string[];
  };

  matches: {
    strongMatches: string[];
    transferableSkills: string[];
  };

  recommendation: {
    summary: string;
    applyRecommendation:
      | "recommended"
      | "consider"
      | "not_recommended";
    nextSteps: string[];
  };
};

function extractJson(text: string): CareerInsight {
  const cleaned = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");

  if (
    first === -1 ||
    last === -1 ||
    last <= first
  ) {
    throw new Error(
      "No valid JSON object was found in the AI response."
    );
  }

  return JSON.parse(
    cleaned.slice(first, last + 1)
  ) as CareerInsight;
}

function getText(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function cleanStringArray(
  value: unknown,
  limit: number
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item) =>
        typeof item === "string" &&
        item.trim()
    )
    .map((item) => item.trim())
    .slice(0, limit);
}

function normalizeInsight(
  raw: any
): CareerInsight {
  const mismatch =
    raw?.mismatch &&
    typeof raw.mismatch === "object"
      ? raw.mismatch
      : {};

  const matches =
    raw?.matches &&
    typeof raw.matches === "object"
      ? raw.matches
      : {};

  const recommendation =
    raw?.recommendation &&
    typeof raw.recommendation === "object"
      ? raw.recommendation
      : {};

  const rawDecision =
    recommendation.applyRecommendation;

  const applyRecommendation:
    | "recommended"
    | "consider"
    | "not_recommended" =
    rawDecision === "recommended" ||
    rawDecision === "not_recommended"
      ? rawDecision
      : "consider";

  return {
    mismatch: {
      summary: getText(mismatch.summary),

      missingRequirements:
        cleanStringArray(
          mismatch.missingRequirements,
          5
        ),

      unsupportedClaims:
        cleanStringArray(
          mismatch.unsupportedClaims,
          4
        ),
    },

    matches: {
      strongMatches:
        cleanStringArray(
          matches.strongMatches,
          5
        ),

      transferableSkills:
        cleanStringArray(
          matches.transferableSkills,
          4
        ),
    },

    recommendation: {
      summary:
        getText(recommendation.summary),

      applyRecommendation,

      nextSteps:
        cleanStringArray(
          recommendation.nextSteps,
          3
        ),
    },
  };
}

function fallbackInsight(): CareerInsight {
  return {
    mismatch: {
      summary:
        "The application could not be analyzed.",
      missingRequirements: [],
      unsupportedClaims: [],
    },

    matches: {
      strongMatches: [],
      transferableSkills: [],
    },

    recommendation: {
      summary:
        "Review the resume and job posting, then try again.",
      applyRecommendation: "consider",
      nextSteps: [
        "Confirm that the complete resume is available.",
        "Confirm that the full job description is available.",
        "Run the analysis again.",
      ],
    },
  };
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error: "Missing OPENAI_API_KEY.",
          ...fallbackInsight(),
        },
        {
          status: 500,
        }
      );
    }

    const body = await req.json();

    const resume = getText(
      body.resume_text
    );

    const coverLetter = getText(
      body.cover_letter_text
    );

    const jobTitle =
      getText(body.job_title) ||
      "the position";

    const company =
      getText(body.company) ||
      "the company";

    const jobDescription = getText(
      body.job_description
    );

    if (!resume) {
      return NextResponse.json(
        {
          error:
            "The saved resume could not be loaded.",
          ...fallbackInsight(),
        },
        {
          status: 400,
        }
      );
    }

    if (!jobDescription) {
      return NextResponse.json(
        {
          error:
            "The job description could not be loaded.",
          ...fallbackInsight(),
        },
        {
          status: 400,
        }
      );
    }

    const response =
      await client.responses.create({
        model:
          process.env
            .OPENAI_PACKAGE_MODEL ||
          "gpt-5.5",

        input: `
You are Career Élan's Canadian recruiter, ATS specialist, and job-application analyst.

Analyze the saved application package against the complete job posting.

Use the same conservative factual standards as Career Élan's Generate Package analysis.

==================================================
FACTUAL SOURCES
==================================================

The SAVED RESUME is the primary factual source about the candidate.

The SAVED COVER LETTER may provide supporting context, but it must not override or contradict the resume.

The JOB DESCRIPTION describes employer requirements. It is not evidence that the candidate has those qualifications.

Never invent or assume:

- employers
- job titles
- employment dates
- responsibilities
- years of experience
- education
- degrees
- certifications
- licences
- professional registration
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
- schedule availability
- driver's licence
- willingness to travel or relocate

==================================================
JOB ANALYSIS
==================================================

Analyze the complete job posting for:

- main responsibilities
- mandatory requirements
- preferred requirements
- required experience
- education requirements
- certifications
- licences
- regulated professional status
- security requirements
- bilingual or multilingual requirements
- schedule and shift requirements
- weekend or holiday work
- driver's licence
- travel or mobility requirements
- required software
- required equipment
- technical skills
- repeated ATS keywords

Compare every important requirement against the saved resume.

Classify the candidate's evidence conservatively.

A requirement may be:

- directly supported
- realistically transferable
- missing
- unclear

Transferable experience is not direct proof of a mandatory technical, legal, educational, or regulated requirement.

==================================================
MATCHES
==================================================

strongMatches:

Include only requirements that are directly and clearly supported by the saved resume.

Examples:

- matching software explicitly listed in the resume
- directly related responsibilities
- clearly supported administrative, customer-service, coordination, training, documentation, or technical experience
- explicitly stated language skills

Do not place loosely related experience in strongMatches.

transferableSkills:

Include realistic transferable experience that may help in the role but does not prove direct industry experience.

Clearly describe the connection.

Do not present transferable experience as a direct match.

==================================================
MISMATCH
==================================================

missingRequirements:

Include important mandatory or preferred requirements that are missing or not confirmed.

Pay special attention to:

- required degrees
- required years of experience
- licences
- regulated credentials
- work authorization
- security clearance
- bilingual requirements
- shift availability
- driver's licence
- technical experience
- equipment experience
- location or on-site availability

Use wording such as:

- "is not confirmed"
- "is not shown in the resume"
- "could not be verified"
- "direct experience is not demonstrated"

Do not falsely state that the candidate definitely lacks something when the resume simply does not confirm it.

unsupportedClaims:

List claims that must not be added to the application because the source material does not support them.

Examples:

- Do not claim direct warehouse-supervisor experience.
- Do not claim authorization to work in Canada unless separately verified.
- Do not claim a required licence that is not shown.
- Do not claim bilingual proficiency without evidence.
- Do not claim shift availability unless confirmed.

==================================================
RECOMMENDATION
==================================================

applyRecommendation must be one of:

- recommended
- consider
- not_recommended

Use:

recommended:
The candidate has strong direct evidence for the role and no major mandatory qualification is missing.

consider:
The candidate has useful direct or transferable experience, but one or more important requirements must be confirmed or addressed.

not_recommended:
A central mandatory, regulated, legal, educational, or technical qualification is clearly unsupported.

The summary must explain the decision honestly.

nextSteps must contain practical actions only.

Examples:

- confirm an unverified qualification
- confirm work authorization
- confirm schedule availability
- verify an education credential
- add only genuinely supported experience
- prepare examples of transferable experience

==================================================
IMPORTANT CONSISTENCY RULES
==================================================

This analysis should be as close as reasonably possible to Career Élan's Generate Package analysis.

Use the same distinction between:

- direct matches
- transferable skills
- missing requirements
- unsupported claims

However:

- Do not calculate an ATS score.
- Do not return overallMatch.
- Do not return matchLevel.
- Do not return an interview probability.
- Do not estimate a percentage.
- Do not compare wording line by line.
- Minor wording differences from Generate Package are acceptable.
- The substantive conclusions should remain consistent when the resume and job posting are the same.

==================================================
OUTPUT
==================================================

Return only valid JSON.

Do not use Markdown.
Do not use code fences.
Do not add properties outside the required structure.

Use exactly this structure:

{
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
  }
}

Limits:

- missingRequirements: maximum 5
- unsupportedClaims: maximum 4
- strongMatches: maximum 5
- transferableSkills: maximum 4
- nextSteps: maximum 3

==================================================
JOB INFORMATION
==================================================

Job title:

${jobTitle}

Company:

${company}

Complete job description:

${jobDescription}

==================================================
SAVED RESUME — PRIMARY FACTUAL SOURCE
==================================================

${resume}

==================================================
SAVED COVER LETTER — SUPPORTING CONTEXT ONLY
==================================================

${coverLetter}
`,
      });

    const rawInsight =
      extractJson(
        response.output_text
      );

    const insight =
      normalizeInsight(rawInsight);

    return NextResponse.json(
      insight
    );
  } catch (error) {
    console.error(
      "CAREER INSIGHT ERROR =",
      error
    );

    const details =
      error instanceof Error
        ? error.message
        : "Unknown career insight error.";

    return NextResponse.json(
      {
        error:
          "Failed to analyze the saved application package.",
        details,
        ...fallbackInsight(),
      },
      {
        status: 500,
      }
    );
  }
}