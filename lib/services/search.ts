export type SearchJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  type: string;
  category: string;
  categories: string[];
  description: string;
  url: string;
  posted: string;
  salary: string;
  source: string;
  logo: string;
  match?: number;
};

export type SearchJobsResponse = {
  jobs: SearchJob[];
  count: number;
  page: number;
  source: string;
  /*
    The provider's own continuation token for the page after this one, or
    null when there is no page after this one. Opaque: the only thing any
    caller may do with it is hand it back unchanged as `cursor`.
  */
  nextCursor?: string | null;
};

type SearchJobsParams = {
  query: string;
  country?: string;
  state?: string;
  city?: string;
  jobType?: string;
  category?: string;
  remote?: string;
  datePosted?: string;
  salary?: string;
  /*
    The number the UI puts on this page. A label only - it is echoed back in
    the response so a caller can confirm which page it received, and it is
    never turned into a provider page number. /search-v2 has no page-number
    pagination; position in the result set comes from `cursor` alone.
  */
  page?: number;
  /*
    Omitted for the first page of a search. For every page after that, the
    exact `nextCursor` string the previous page returned - never parsed,
    decoded, incremented or otherwise interpreted on the way through.
  */
  cursor?: string;
};

export async function searchJobs({
  query,
  country = "CA",
  state,
  city,
  jobType,
  category,
  remote,
  datePosted,
  salary,
  page = 1,
  cursor,
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

  if (category && category !== "All" && category !== "All Jobs") {
    params.set("category", category);
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

  /*
    Absent on the first request of a search, which is what tells the provider
    to start at the beginning. Sent verbatim on every later page.
  */
  if (cursor) {
    params.set("cursor", cursor);
  }

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