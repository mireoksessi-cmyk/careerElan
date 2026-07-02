import openai from "./openai";

export async function parseResume(resumeText: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-5",
    temperature: 0.2,

    response_format: {
      type: "json_object",
    },

    messages: [
      {
        role: "system",
        content: `
You are an expert resume parser.

Extract all resume information.

Return ONLY valid JSON.

{
  "firstName":"",
  "lastName":"",
  "email":"",
  "phone":"",
  "location":"",
  "summary":"",
  "targetRoles":[],
  "skills":[],
  "education":[],
  "experience":[],
  "languages":[],
  "certifications":[]
}
`,
      },
      {
        role: "user",
        content: resumeText,
      },
    ],
  });

  return JSON.parse(response.choices[0].message.content ?? "{}");
}