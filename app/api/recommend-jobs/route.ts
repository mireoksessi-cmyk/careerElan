import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

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

export async function POST(req: Request) {
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
    }

    if (!careerMemory) {
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

    console.log(
      "===== SELECTED RESUME SOURCE ====="
    );
    console.log(selectedResumeSource);

    console.log(
      "===== SELECTED RESUME ID ====="
    );
    console.log(
      selectedResumeId || "None"
    );

    console.log(
      "===== CAREER MEMORY ====="
    );
    console.log(
      JSON.stringify(
        careerMemory,
        null,
        2
      )
    );

    console.log(
      "===== SELECTED KEYWORD ====="
    );
    console.log(
      selectedKeyword || "None"
    );

    const response =
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

    console.log(
      "===== GPT RAW OUTPUT ====="
    );
    console.log(response.output_text);

    const json = extractJson(
      response.output_text
    );

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

    console.log(
      "===== FINAL JOBS ====="
    );
    console.log(
      JSON.stringify(jobs, null, 2)
    );

    return NextResponse.json({
      jobs,
      selectedResumeSource,
      selectedResumeId,
    });
  } catch (error) {
    console.error(
      "Recommended jobs error:",
      error
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
}