/*
  Converts a naive "wall clock" datetime string (no UTC offset - e.g. a
  feed field like "2026-10-07 10:00:00" that is implicitly local to the
  institution's own timezone) into a real UTC Date, correctly accounting
  for that zone's DST offset on that specific date. Needed for feed
  formats that don't supply a separate UTC-equivalent field (Carleton's
  cutheme API) - Intl.DateTimeFormat is used instead of adding a tz
  database dependency, since Node's ICU build already carries one.
*/
export function parseLocalDateTimeInZone(
  naive: string,
  timeZone: string
): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(
    naive
  );
  if (!match) return null;

  const [, y, mo, d, h, mi, s] = match.map(Number);
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, s);

  /*
    A single offset lookup at utcGuess (treating the naive local time as if
    it were already UTC) samples the WRONG side of a DST transition for any
    wall-clock time shortly after that transition - confirmed via direct
    testing: "2026-03-08 03:30:00" in America/Toronto (30 minutes after
    that year's spring-forward) came out an hour early, and
    "2026-11-01 03:30:00" (after fall-back) came out an hour late, both
    because utcGuess itself still lands on the pre-transition side in real
    UTC terms even though the wall-clock time being converted is
    post-transition. Refining once - using the first offset to get a
    better UTC estimate, then re-reading the offset at THAT estimate -
    converges correctly for both directions; only the inherently ambiguous
    (fall-back repeated hour) or nonexistent (spring-forward skipped hour)
    wall-clock times have no single correct answer, and no ICS/API source
    in this registry has ever produced one of those.
  */
  const firstOffsetMinutes = getTimeZoneOffsetMinutes(timeZone, utcGuess);
  const refinedUtcGuess = utcGuess - firstOffsetMinutes * 60000;
  const offsetMinutes = getTimeZoneOffsetMinutes(timeZone, refinedUtcGuess);
  return new Date(utcGuess - offsetMinutes * 60000);
}

function getTimeZoneOffsetMinutes(timeZone: string, atUtcMs: number): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(atUtcMs))) {
    parts[part.type] = part.value;
  }

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return (asIfUtc - atUtcMs) / 60000;
}
