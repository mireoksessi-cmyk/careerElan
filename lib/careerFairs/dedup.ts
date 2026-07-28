/*
  Cross-source duplicate detection - unique(source_name, source_event_id)
  alone can't catch the same real-world event appearing from two different
  sources (e.g. a joint fair cross-posted by two partner institutions),
  since each source assigns its own event id. This key is deliberately
  coarse-but-safe: normalized title + same calendar day + same city/
  province. Day-level (not exact-timestamp) granularity tolerates the kind
  of small start-time discrepancies (9:00am vs 9:30am) that show up when
  two institutions each transcribe the same fair into their own calendar
  system. Requiring city+province alongside the title avoids merging two
  different fairs that happen to share a generic name ("Career Fair 2026")
  in different cities.
*/
export function buildDedupKey(params: {
  title: string;
  startAt: string;
  city: string | null;
  province: string | null;
}): string {
  const normalizedTitle = params.title
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  const day = params.startAt.slice(0, 10);
  const city = (params.city || "").toLowerCase().trim();
  const province = (params.province || "").toLowerCase().trim();

  return `${normalizedTitle}|${day}|${city}|${province}`;
}
