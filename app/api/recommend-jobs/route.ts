import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  hashContent,
  normalizeText,
} from "@/lib/cache/contentHash";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type SelectedResumeSource =
  | "career_memory"
  | "uploaded";

function extractJson(text: string) {
  const cleaned = text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");

  if (first === -1 || last === -1) {
    throw new Error("No JSON found.");
  }

  return JSON.parse(
    cleaned.slice(first, last + 1)
  );
}

/*
  Only the substantive profile content that can actually change what
  gets recommended - never identity/contact fields (name, email, phone,
  linkedin), styling/selection-state columns (resume_template,
  cover_template, theme, font, text_size, tone, profile_strength,
  required_completed, resume_name, selected_resume_type,
  selected_resume_id, selected_cover_letter_id), or timestamps. Editing
  any of those must never invalidate the cache; editing anything below
  must always invalidate it.
*/
function careerMemoryContentFields(
  memory: Record<string, unknown>
) {
  return {
    summary: memory.summary ?? null,
    target_roles: Array.isArray(memory.target_roles)
      ? [...(memory.target_roles as string[])].sort()
      : [],
    skills: Array.isArray(memory.skills)
      ? [...(memory.skills as string[])].sort()
      : [],
    languages: memory.languages ?? null,
    education: memory.education ?? null,
    experience: memory.experience ?? null,
    certifications: memory.certifications ?? null,
    career_goal_summary: memory.career_goal_summary ?? null,
    headline: memory.headline ?? null,
    target_industry: memory.target_industry ?? null,
    target_location: memory.target_location ?? null,
    location: memory.location ?? null,
    salary_expectation: memory.salary_expectation ?? null,
    projects: memory.projects ?? null,
    volunteer_experience: memory.volunteer_experience ?? null,
  };
}

export async function POST(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      {
        jobs: [],
        error: "Unauthorized.",
      },
      {
        status: 401,
      }
    );
  }

  let resumeId: string | null = null;
  let resumeSource: "uploaded" | "career_memory" | null = null;
  let resumeContentHash: string | null = null;

  try {
    const body = await req.json();

    const selectedResumeSource: SelectedResumeSource =
      body.selectedResumeSource === "uploaded"
        ? "uploaded"
        : "career_memory";

    const selectedResumeId =
      typeof body.selectedResumeId === "string" &&
      body.selectedResumeId.trim()
        ? body.selectedResumeId.trim()
        : null;

    const selectedKeyword =
      typeof body.selectedKeyword === "string"
        ? body.selectedKeyword.trim()
        : "";

    let careerMemory: Record<
      string,
      unknown
    > | null = null;

    /*
     * Create Resume 선택
     * → career_memory 테이블 사용
     */
    if (
      selectedResumeSource ===
      "career_memory"
    ) {
      const {
        data,
        error,
      } = await supabase
        .from("career_memory")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error(
          "Career Memory query error:",
          error
        );

        return NextResponse.json(
          {
            jobs: [],
            error:
              "Failed to load Career Memory.",
          },
          {
            status: 500,
          }
        );
      }

      if (!data) {
        return NextResponse.json(
          {
            jobs: [],
            error:
              "Career Memory was not found.",
          },
          {
            status: 404,
          }
        );
      }

      careerMemory = {
        source: "career-memory",
        ...data,
      };

      resumeId = data.id;
      resumeSource = "career_memory";
      resumeContentHash = hashContent({
        profile: careerMemoryContentFields(data),
        selectedKeyword,
      });
    }

    /*
     * Import Resume 선택
     * → resumes 테이블에서 선택된 이력서 사용
     */
    if (
      selectedResumeSource === "uploaded"
    ) {
      if (!selectedResumeId) {
        return NextResponse.json(
          {
            jobs: [],
            error:
              "No uploaded resume was selected.",
          },
          {
            status: 400,
          }
        );
      }

      const {
        data,
        error,
      } = await supabase
        .from("resumes")
        .select("*")
        // ownership check independent of RLS - a client-supplied resume
        // id belonging to a different user can never match this query.
        .eq("id", selectedResumeId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error(
          "Uploaded resume query error:",
          error
        );

        return NextResponse.json(
          {
            jobs: [],
            error:
              "Failed to load the selected resume.",
          },
          {
            status: 500,
          }
        );
      }

      if (!data) {
        return NextResponse.json(
          {
            jobs: [],
            error:
              "The selected resume was not found.",
          },
          {
            status: 404,
          }
        );
      }

      careerMemory = {
        source: "uploaded-resume",
        ...data,
      };

      resumeId = data.id;
      resumeSource = "uploaded";
      resumeContentHash = hashContent({
        resumeText: normalizeText(
          data.original_text || ""
        ),
        selectedKeyword,
      });
    }

    if (
      !careerMemory ||
      !resumeId ||
      !resumeSource ||
      !resumeContentHash
    ) {
      return NextResponse.json(
        {
          jobs: [],
          error:
            "No career profile was selected.",
        },
        {
          status: 400,
        }
      );
    }

    /*
      Permanent, content-addressed cache: identical resume content for
      this exact user/resume always returns the same stored result with
      zero further OpenAI calls, regardless of file rename, re-selection,
      refresh, re-login, or device. Claim is atomic (advisory-locked
      inside the RPC) so concurrent requests for the same key can never
      both call OpenAI.
    */
    const { data: claimRows, error: claimError } =
      await supabaseAdmin.rpc(
        "claim_recommended_job_cache",
        {
          p_user_id: user.id,
          p_resume_id: resumeId,
          p_resume_source: resumeSource,
          p_resume_content_hash: resumeContentHash,
        }
      );

    if (claimError) {
      console.error(
        "Recommended jobs cache claim error:",
        claimError
      );

      return NextResponse.json(
        {
          jobs: [],
          error:
            "Failed to check cached recommendations.",
        },
        {
          status: 500,
        }
      );
    }

    const claim = Array.isArray(claimRows)
      ? claimRows[0]
      : claimRows;

    if (!claim?.claimed) {
      if (claim?.status === "completed") {
        const cached = claim.result || {};

        return NextResponse.json({
          jobs: cached.jobs ?? [],
          selectedResumeSource,
          selectedResumeId,
          cached: true,
        });
      }

      return NextResponse.json(
        {
          jobs: [],
          error:
            "Recommendations are already being generated for this resume. Please wait a moment.",
        },
        {
          status: 409,
        }
      );
    }

    let response;

    try {
      response =
        await client.responses.create({
          model: "gpt-5.5",

          input: `
You are an AI career advisor for a Canadian career platform.

Your job is to recommend realistic occupations based on the
person's Career Memory and current career interest.

Apply the same evaluation logic to every occupation, industry,
career field, employer, organization, trade, and work environment.

Do not limit recommendations to any specific occupation or industry.

Use the following priority:

1. Target roles and career goals
2. Skills
3. Work and volunteer experience
4. Education, certifications, licences, permits, and projects
5. Selected dashboard keyword as a current preference

The Career Memory is the primary source of truth.

The selected dashboard keyword is a secondary preference.
It should refine the recommendations, but it must not override
the person's actual education, experience, skills, licences,
certifications, or realistic qualification level.

Interpret the selected keyword broadly and correctly.

The selected keyword may be:

- a job title
- an occupation
- an industry
- an employer
- an organization
- a department
- a trade
- a work environment
- an abbreviation
- an informal job name
- a field of study
- a general career interest

When the keyword is not an exact job title, infer the most likely
related occupations before generating recommendations.

When the keyword refers to an employer or organization, recommend
realistic occupations within that organization or industry instead
of treating the organization name as a job title.

Prefer commonly recognized Canadian occupation titles.

For any occupation that requires a licence, certification,
registration, degree, permit, security clearance, background check,
union qualification, technical credential, driving licence,
professional designation, or specific work experience, verify
whether the Career Memory shows that requirement.

Do not invent licences, certifications, degrees, permits,
registrations, skills, clearances, or work experience that are
not present in the Career Memory.

If the person is not yet qualified for the selected occupation,
recommend realistic entry-level, assistant, trainee, apprentice,
technician, support, helper, coordinator, clerk, associate,
operator, or adjacent roles within the same field.

Do not recommend a fully qualified or licensed professional role
when the Career Memory clearly shows that the person does not have
the required education, licence, certification, registration,
permit, clearance, or experience.

When a regulated occupation is relevant in Canada, identify the
likely missing licence, certification, registration, permit,
education, or experience in the "missing" field.

Return ONLY valid JSON.

Use this exact JSON structure:

{
  "jobs": [
    {
      "title": "",
      "company": "Recommended Career",
      "location": "",
      "type": "",
      "tags": [],
      "match": "",
      "matched": [],
      "missing": []
    }
  ]
}

Rules:

- Recommend exactly 10 jobs.
- Recommend realistic jobs that match the person's profile.
- Apply the same rules to all occupations and industries.
- Give the greatest priority to target roles, career goals,
  skills, and work experience.
- Use the selected dashboard keyword as a secondary preference.
- Prefer occupation titles commonly used in Canada.
- Use specific occupation titles, not vague industry names.
- Avoid repeating the same or nearly identical occupation.
- Include a useful mix of strong matches and realistic adjacent roles.
- Do not recommend roles that are clearly far above the person's
  current qualifications.
- Do not make unsupported assumptions about the person's background.
- Do not claim the person has a qualification unless it appears
  in the Career Memory.
- match must be a percentage string between "70%" and "99%".
- Higher match percentages must be supported by stronger evidence.
- Do not give every job nearly the same match percentage.
- matched must contain 3 to 5 specific reasons based only on
  information found in the Career Memory.
- missing must contain 1 to 3 realistic missing skills,
  qualifications, licences, certifications, permits,
  registrations, or experience areas.
- If no major requirement is missing, include a realistic
  development area instead of inventing a mandatory qualification.
- tags must contain 2 to 4 short and relevant tags.
- company must always be "Recommended Career".
- location should use the preferred location from the Career Memory
  when available.
- If no preferred location is available, use "Canada".
- type must be exactly one of:
  "Full-time", "Part-time", "Hybrid", or "Remote".
- Do not return markdown.
- Do not return code fences.
- Do not return explanations outside the JSON.

Selected dashboard keyword:

${selectedKeyword || "No keyword selected"}

Career Memory:

${JSON.stringify(careerMemory)}
`,
        });
    } catch (openAiError) {
      console.error(
        "Recommended jobs OpenAI error:",
        openAiError
      );

      await supabaseAdmin.rpc(
        "fail_recommended_job_cache",
        {
          p_user_id: user.id,
          p_resume_id: resumeId,
          p_resume_source: resumeSource,
          p_resume_content_hash: resumeContentHash,
          p_error_code: "OPENAI_ERROR",
        }
      );

      return NextResponse.json(
        {
          jobs: [],
          error:
            "Failed to generate recommended jobs.",
        },
        {
          status: 500,
        }
      );
    }

    let json;

    try {
      json = extractJson(
        response.output_text
      );
    } catch (parseError) {
      console.error(
        "Recommended jobs parse error:",
        parseError
      );

      await supabaseAdmin.rpc(
        "fail_recommended_job_cache",
        {
          p_user_id: user.id,
          p_resume_id: resumeId,
          p_resume_source: resumeSource,
          p_resume_content_hash: resumeContentHash,
          p_error_code: "MALFORMED_AI_RESPONSE",
        }
      );

      return NextResponse.json(
        {
          jobs: [],
          error:
            "Failed to generate recommended jobs.",
        },
        {
          status: 500,
        }
      );
    }

    const jobs = (
      Array.isArray(json.jobs)
        ? json.jobs
        : []
    )
      .slice(0, 10)
      .map((job: any) => ({
        title:
          typeof job.title === "string" &&
          job.title.trim()
            ? job.title.trim()
            : "Recommended Job",

        company: "Recommended Career",

        location:
          typeof job.location === "string" &&
          job.location.trim()
            ? job.location.trim()
            : "Canada",

        type: [
          "Full-time",
          "Part-time",
          "Hybrid",
          "Remote",
        ].includes(job.type)
          ? job.type
          : "Full-time",

        tags: Array.isArray(job.tags)
          ? job.tags
              .filter(
                (item: unknown) =>
                  typeof item === "string" &&
                  item.trim().length > 0
              )
              .map(
                (item: string) =>
                  item.trim()
              )
              .slice(0, 4)
          : [],

        match:
          typeof job.match === "string" &&
          /^\d{2}%$/.test(
            job.match.trim()
          )
            ? job.match.trim()
            : "80%",

        matched: Array.isArray(
          job.matched
        )
          ? job.matched
              .filter(
                (item: unknown) =>
                  typeof item === "string" &&
                  item.trim().length > 0
              )
              .map(
                (item: string) =>
                  item.trim()
              )
              .slice(0, 5)
          : [],

        missing: Array.isArray(
          job.missing
        )
          ? job.missing
              .filter(
                (item: unknown) =>
                  typeof item === "string" &&
                  item.trim().length > 0
              )
              .map(
                (item: string) =>
                  item.trim()
              )
              .slice(0, 3)
          : [],
      }));

    /*
      A few quick, cheap DB-only retries (no OpenAI cost) before giving
      up - this is the one call that must not silently fail while still
      reporting success, or the same resume content would be re-billed
      on every future request.
    */
    let completeError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await supabaseAdmin.rpc(
        "complete_recommended_job_cache",
        {
          p_user_id: user.id,
          p_resume_id: resumeId,
          p_resume_source: resumeSource,
          p_resume_content_hash: resumeContentHash,
          p_result: { jobs },
        }
      );

      completeError = error;

      if (!completeError) {
        break;
      }

      if (attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(resolve, 200)
        );
      }
    }

    if (completeError) {
      /*
        Fail closed: the generation itself succeeded, but it could not be
        confirmed as cached even after retrying - never report success
        while that is unconfirmed, since a later request for the same
        resume content would otherwise find no completed cache row and
        pay for another OpenAI call. The client's existing retry (re-open
        the resume / reload Dashboard) lands on the same cache key and
        reclaims it normally.
      */
      console.error(
        "Recommended jobs cache completion error:",
        completeError
      );

      return NextResponse.json(
        {
          jobs: [],
          error:
            "Recommendations were generated, but could not be saved. Please try again.",
        },
        {
          status: 500,
        }
      );
    }

    return NextResponse.json({
      jobs,
      selectedResumeSource,
      selectedResumeId,
      cached: false,
    });
  } catch (error) {
    console.error(
      "Recommended jobs error:",
      error
    );

    if (resumeId && resumeSource && resumeContentHash) {
      try {
        await supabaseAdmin.rpc(
          "fail_recommended_job_cache",
          {
            p_user_id: user.id,
            p_resume_id: resumeId,
            p_resume_source: resumeSource,
            p_resume_content_hash: resumeContentHash,
            p_error_code: "UNKNOWN",
          }
        );
      } catch {
        // best-effort only
      }
    }

    return NextResponse.json(
      {
        jobs: [],
        error:
          "Failed to generate recommended jobs.",
      },
      {
        status: 500,
      }
    );
  }
}
