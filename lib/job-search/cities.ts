export type CitySuggestion = {
  id: string;
  name: string;
  label: string;
  region: string;
};

type CitySearchResponse = {
  cities: CitySuggestion[];
  error?: string;
};

export async function searchCities(
  query: string,
  country: string
): Promise<CitySuggestion[]> {
  const params = new URLSearchParams();

  params.set("q", query);
  params.set("country", country);

  const response = await fetch(
    `/api/cities?${params.toString()}`,
    {
      method: "GET",
      cache: "no-store",
    }
  );

  const data =
    (await response.json()) as CitySearchResponse;

  if (!response.ok) {
    throw new Error(
      data.error || "Failed to search cities."
    );
  }

  return data.cities || [];
}