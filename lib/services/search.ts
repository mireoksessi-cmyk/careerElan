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
  country?: string;
  state?: string;
  city?: string;
  jobType?: string;
  remote?: string;
  datePosted?: string;
  salary?: string;
  page?: number;
};

export async function searchJobs({
  query,
  country = "CA",
  state,
  city,
  jobType,
  remote,
  datePosted,
  salary,
  page = 1,
}: SearchJobsParams): Promise<SearchJobsResponse> {
  const params = new URLSearchParams();

  params.set(
    "q",
    query.trim() || "administrative assistant"
  );

  params.set("country", country);

  if (state && state !== "All") {
    params.set("province", state);
  }

  if (city && city !== "All") {
    params.set("city", city);
  }

  if (jobType && jobType !== "All") {
    params.set("jobType", jobType);
  }

  if (remote) {
    params.set("remote", remote);
  }

  if (datePosted) {
    params.set("datePosted", datePosted);
  }

  if (salary) {
    params.set("salary", salary);
  }

  params.set("page", page.toString());

  const res = await fetch(
    `/api/search-jobs?${params.toString()}`,
    {
      method: "GET",
      cache: "no-store",
    }
  );

  const data:
    | SearchJobsResponse
    | { error: string } = await res.json();

  if (!res.ok) {
    throw new Error(
      "error" in data
        ? data.error
        : "Job search service is temporarily unavailable. Please try again later."
    );
  }

  return data as SearchJobsResponse;
}