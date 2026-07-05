import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import pdf from "pdf-parse-new";
import mammoth from "mammoth";
import { fromBuffer } from "pdf2pic";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

function normalizeParagraph(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdfText(buffer: Buffer) {
  try {
    const parsed = await pdf(buffer);

    if (parsed.text && parsed.text.trim().length > 300) {
      return parsed.text;
    }
  } catch {}

  return "";
}

async function pdfToImages(buffer: Buffer) {
  const convert = fromBuffer(buffer, {
    density: 220,
    format: "png",
    width: 1700,
    height: 2200,
  });

  const images: string[] = [];

  let page = 1;

  while (true) {
    try {
      const result = await convert(page, {
        responseType: "base64",
      });

      if (!result.base64) break;

      images.push(result.base64);

      page++;
    } catch {
      break;
    }
  }

  return images;
}

async function visionOCR(images: string[]) {

  let text = "";

  for (const img of images) {

    const res = await openai.chat.completions.create({

      model: "gpt-4.1",

      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Extract every visible word from this cover letter. Preserve formatting and paragraphs. Do not summarize.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${img}`,
              },
            },
          ],
        },
      ],
    });

    text +=
      (res.choices[0].message.content || "") + "\n";
  }

  return text;
}
export async function POST(req: NextRequest) {
  try {

    const formData = await req.formData();

    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        {
          success: false,
          message: "Cover letter file is missing.",
        },
        {
          status: 400,
        }
      );
    }

    const buffer = Buffer.from(
      await file.arrayBuffer()
    );

    let coverLetterText = "";

    // ------------------------
    // PDF
    // ------------------------

    if (file.name.toLowerCase().endsWith(".pdf")) {

      coverLetterText =
        await extractPdfText(buffer);

      if (coverLetterText.trim().length < 300) {

        console.log(
          "Cover Letter appears scanned. Running Vision OCR..."
        );

        const images =
          await pdfToImages(buffer);

        coverLetterText =
          await visionOCR(images);

        console.log(
          "Vision OCR complete."
        );
      }

    }

    // ------------------------
    // DOCX
    // ------------------------

    else if (
      file.name.toLowerCase().endsWith(".docx")
    ) {

      const doc =
        await mammoth.extractRawText({
          buffer,
        });

      coverLetterText = doc.value;

    }

    // ------------------------
    // TXT
    // ------------------------

    else if (
      file.name.toLowerCase().endsWith(".txt")
    ) {

      coverLetterText =
        buffer.toString("utf8");

    }

    else {

      return NextResponse.json(
        {
          success: false,
          message:
            "Unsupported file format.",
        },
        {
          status: 400,
        }
      );

    }

    if (!coverLetterText.trim()) {

      return NextResponse.json(
        {
          success: false,
          message:
            "No readable text found.",
        },
        {
          status: 400,
        }
      );

    }

    coverLetterText =
      normalizeParagraph(
        coverLetterText
      );

    // ------------------------
    // GPT Reconstruction
    // ------------------------

    const rebuilt =
      await openai.chat.completions.create({

        model: "gpt-4.1-mini",

        temperature: 0,

        messages: [

          {
            role: "system",

            content: `
You are an expert cover letter reconstruction engine.

Rebuild the cover letter exactly as a human would type it.

Rules:

- Never invent information.
- Never summarize.
- Preserve paragraphs.
- Preserve greetings.
- Preserve closing.
- Preserve signature.
- Preserve dates.
- Preserve addresses.
- Preserve company names.
- Preserve formatting.
- If OCR merged lines,
split them naturally.

Output ONLY the rebuilt cover letter.
`,
          },

          {
            role: "user",

            content:
              coverLetterText,
          },

        ],

      });

    coverLetterText =
      rebuilt.choices[0]
        .message.content ||
      coverLetterText;

    console.log(
      coverLetterText
    );

    const numberedLetter =
      coverLetterText
        .split("\n")
        .map(
          (line, i) =>
            `${i + 1}. ${line}`
        )
        .join("\n");
        const prompt = `
You are an expert cover letter parser.

Return ONLY valid JSON.

Never invent information.

Extract everything you can from the cover letter.

JSON format:

{
  "recipient":"",
  "company":"",
  "jobTitle":"",
  "greeting":"",
  "body":"",
  "closing":"",
  "signature":"",
  "tone":""
}

Rules:

- recipient = Hiring Manager if explicitly written
- company = company name
- jobTitle = position applying for
- greeting = Dear ...
- body = entire body excluding greeting & closing
- closing = Sincerely / Best Regards / Thank you ...
- signature = applicant name
- tone = Professional / Formal / Friendly / Government / Executive

Return ONLY valid JSON.

Cover Letter:

${numberedLetter}
`;

    const completion =
      await openai.chat.completions.create({

        model: "gpt-4.1",

        temperature: 0,

        response_format: {
          type: "json_object",
        },

        messages: [

          {
            role: "system",
            content:
              "You extract cover letter information. Respond ONLY with valid JSON.",
          },

          {
            role: "user",
            content: prompt,
          },

        ],

      });

    const content =
      completion.choices[0]
        .message.content || "{}";

    let parsed;

    try {

      parsed =
        JSON.parse(content);

      // -----------------------------
      // Second verification pass
      // -----------------------------

      const verify =
        await openai.chat.completions.create({

          model: "gpt-4.1-mini",

          temperature: 0,

          response_format: {
            type: "json_object",
          },

          messages: [

            {

              role: "system",

              content: `
You verify cover letter JSON.

Never invent information.

Only fix obvious OCR mistakes.

Never change facts.

Return ONLY valid JSON.
              `,

            },

            {

              role: "user",

              content: `
Original Cover Letter

${numberedLetter}

Parsed JSON

${JSON.stringify(parsed, null, 2)}

Compare both.

Correct only extraction mistakes.

Return ONLY valid JSON.
`,

            },

          ],

        });

      parsed = JSON.parse(
        verify.choices[0]
          .message.content || "{}"
      );

    } catch {

      return NextResponse.json(
        {
          success: false,
          message:
            "AI returned invalid JSON.",
          raw: content,
        },
        {
          status: 500,
        }
      );

    }
    return NextResponse.json({

      success: true,

      data: {

        recipient:
          parsed.recipient || "",

        company:
          parsed.company || "",

        jobTitle:
          parsed.jobTitle || "",

        greeting:
          parsed.greeting || "",

        body:
          parsed.body || "",

        closing:
          parsed.closing || "",

        signature:
          parsed.signature || "",

        tone:
          parsed.tone || "",

        // 앞으로 Preview나 재생성에 사용
        originalText:
          coverLetterText,

      },

    });

  } catch (error) {

    console.error(
      "Cover Letter Parser Error:",
      error
    );

    return NextResponse.json(

      {

        success: false,

        message:
          "Failed to analyze cover letter.",

      },

      {

        status: 500,

      }

    );

  }

}