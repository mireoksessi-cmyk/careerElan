/*
  Every URL this feature stores or fetches (official_url/registration_url
  ingested from external feeds, and the link-reachability checker that
  later fetches them) ultimately originates from a third-party feed, not
  from this app's own user input - but that's exactly why it needs to be
  treated as untrusted. A compromised or malicious feed could embed a URL
  like "http://169.254.169.254/latest/meta-data/" (cloud metadata) or
  "http://localhost:3000/api/internal/..." (this app's own internal
  routes) as an event's link, and if that string were stored and later
  fetched by the link-reachability checker (a server-side fetch with no
  browser sandbox), that's a real SSRF vector. This module is the single
  gate both ingestion and the link checker call before ever storing or
  fetching a feed-supplied URL.
*/

const MAX_URL_LENGTH = 2048;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
  "metadata.google.internal",
]);

/*
  String-level checks only - this does not resolve DNS, so a public
  hostname that resolves to a private IP at fetch time (DNS rebinding)
  isn't caught here. Accepted as a residual risk for this feature's
  threat model (URLs come from a curated registry of named institutional
  feeds, not arbitrary user submissions) rather than adding a custom DNS-
  resolving fetch agent for a low-probability attack path.
*/
function isPrivateOrReservedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, "");

  if (BLOCKED_HOSTNAMES.has(lower)) return true;

  // IPv4 literal - check against private/reserved ranges.
  const ipv4Match = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);
    if (octets.some((n) => n > 255)) return true; // malformed, reject safely
    const [a, b] = octets;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 0) return true; // "this network"
    return false;
  }

  // IPv6 literal - loopback, unique-local, and link-local ranges.
  if (lower.includes(":")) {
    if (lower === "::1" || lower === "[::1]") return true;
    if (/^\[?fe80:/.test(lower)) return true; // link-local
    if (/^\[?f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique-local (fc00::/7)
    return false;
  }

  if (lower.endsWith(".local") || lower.endsWith(".internal")) return true;

  return false;
}

export function isSafeExternalUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;
  if (rawUrl.length > MAX_URL_LENGTH) return false;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  // A URL carrying embedded credentials (https://user:pass@host/...) is
  // never something a legitimate public event link needs.
  if (parsed.username || parsed.password) return false;

  if (isPrivateOrReservedHostname(parsed.hostname)) return false;

  return true;
}
