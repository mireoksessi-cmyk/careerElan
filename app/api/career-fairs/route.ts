import { NextResponse } from "next/server";

const queries: Record<string, string> = {
  toronto: "Toronto career fair",
  ontario: "Ontario career fair",
  canada: "Canada career fair",
  world: "Career fair",
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const region =
      (searchParams.get("region") || "toronto").toLowerCase();

    const query = queries[region] || queries.toronto;

    const apiKey = process.env.GOOGLE_API_KEY!;
    const cx = process.env.GOOGLE_CSE_ID!;

    const url =
      `https://www.googleapis.com/customsearch/v1?` +
      `key=${apiKey}` +
      `&cx=${cx}` +
      `&q=${encodeURIComponent(query)}` +
      `&num=10`;

    const response = await fetch(url, {
      next: { revalidate: 60 * 60 },
    });

    if (!response.ok) {
     const error = await response.text();

     console.error("Google Error:");
      console.error(error);

      throw new Error(error);
    }

    const data = await response.json();

    const fairs =
      data.items?.map((item: any) => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        image:
          item.pagemap?.cse_image?.[0]?.src ??
          item.pagemap?.cse_thumbnail?.[0]?.src ??
          "",
        organizer:
          new URL(item.link).hostname.replace("www.", ""),
      })) || [];

    return NextResponse.json({
      region,
      fairs,
    });
  } catch (err) {
    console.error(err);

    return NextResponse.json(
      {
        region: "toronto",
        fairs: [],
        error: "Unable to load career fairs.",
      },
      { status: 500 }
    );
  }
}