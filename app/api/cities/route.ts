import { NextResponse } from "next/server";
import {
  recordExternalApiUsage,
  classifyExternalHttpStatus,
} from "@/lib/externalApi/usageTelemetry";

type GoogleSuggestion = {
  placePrediction?: {
    place?: string;
    placeId?: string;
    text?: {
      text?: string;
      matches?: Array<{
        startOffset?: number;
        endOffset?: number;
      }>;
    };
    structuredFormat?: {
      mainText?: {
        text?: string;
      };
      secondaryText?: {
        text?: string;
      };
    };
    types?: string[];
  };
};

type GoogleAutocompleteResponse = {
  suggestions?: GoogleSuggestion[];
};

const supportedCountries = new Set(["CA"]);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const input = searchParams.get("q")?.trim() || "";
    const country = (
      searchParams.get("country") || "CA"
    ).toUpperCase();

    if (input.length < 2) {
      return NextResponse.json({
        cities: [],
      });
    }

    if (!supportedCountries.has(country)) {
      return NextResponse.json(
        {
          error: "Unsupported country.",
        },
        {
          status: 400,
        }
      );
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Missing GOOGLE_PLACES_API_KEY in environment variables.",
        },
        {
          status: 500,
        }
      );
    }

    /*
      API-C1 - one row per upstream Places request, recorded around this
      call because this is the request Google bills for. The route makes
      exactly one per invocation.

      The body carries the user's typed city text and the response carries
      their suggestions; neither is passed to telemetry, which takes no
      parameter capable of holding them. This endpoint is unauthenticated,
      so rows carry no user - the route is not given an identity it does not
      otherwise need just to attribute a cost line.
    */
    const placesStartedAt = Date.now();

    const response = await fetch(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types",
        },
        body: JSON.stringify({
  input,
  includedRegionCodes: ["ca"],
  languageCode: "en",
}),
        cache: "no-store",
      }
    );

    await recordExternalApiUsage({
      provider: "google_places",
      operation: "PLACES_AUTOCOMPLETE",
      status: response.ok ? "success" : "error",
      httpStatusClass: classifyExternalHttpStatus(response.status),
      durationMs: Date.now() - placesStartedAt,
    });

   if (!response.ok) {
  const errorText = await response.text();

  console.error("Google Places error:", {
    status: response.status,
    body: errorText,
  });

  return NextResponse.json(
    {
      error: `Google Places request failed: ${response.status}`,
      details: errorText,
    },
    {
      status: response.status,
    }
  );
}

    const data =
      (await response.json()) as GoogleAutocompleteResponse;

    const cities = (data.suggestions || [])
      .map((suggestion) => {
        const prediction = suggestion.placePrediction;

        if (!prediction) return null;

        const mainText =
          prediction.structuredFormat?.mainText?.text || "";

        const secondaryText =
          prediction.structuredFormat?.secondaryText?.text || "";

        const fullText =
          prediction.text?.text ||
          [mainText, secondaryText].filter(Boolean).join(", ");

        if (!mainText) return null;

        return {
          id:
            prediction.placeId ||
            prediction.place ||
            fullText,
          name: mainText,
          label: fullText,
          region: secondaryText,
        };
      })
      .filter(
        (
          city
        ): city is {
          id: string;
          name: string;
          label: string;
          region: string;
        } => city !== null
      );

    return NextResponse.json({
      cities,
    });
  } catch (error) {
    console.error("City autocomplete error:", error);

    return NextResponse.json(
      {
        error: "Failed to search cities.",
      },
      {
        status: 500,
      }
    );
  }
}