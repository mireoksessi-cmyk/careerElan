export type SearchJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  type: string;
  category: string;
  description: string;
  url: string;
  posted: string;
  salary: string;
  source: string;
  logo: string;
  match: number;
};

export type SearchJobsResponse = {
  jobs: SearchJob[];
  count: number;
  page: number;
  source: string;
};

type SearchJobsParams = {
  query: string;
  location?: string;
  page?: number;
};

export async function searchJobs({
  query,
  location = "Canada",
  page = 1,
}: SearchJobsParams): Promise<SearchJobsResponse> {
  const params = new URLSearchParams();

  params.set("q", query || "administrative assistant");
  params.set("location", location || "Canada");
  params.set("page", String(page));

  const res = await fetch(`/api/search-jobs?${params.toString()}`, {
    method: "GET",
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      data.error ||
        "Job search service is temporarily unavailable. Please try again later."
    );
  }

  return data;
}