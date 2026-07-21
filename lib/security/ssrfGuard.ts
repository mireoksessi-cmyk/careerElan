import { isIP } from "net";
import { promises as dns } from "dns";

/*
  Server-side URL safety guard for outbound fetches the app makes on a
  user's behalf (currently: app/api/analyze-job-url/route.ts fetching a
  user-supplied job posting URL). Not yet wired into that route - this
  module is intentionally standalone in this phase so it can be reviewed
  and tested on its own before any fetch behavior changes.

  This has nothing to do with how the app itself is reached in the
  browser (e.g. visiting http://localhost:3000, or the app's own calls to
  a local Supabase instance) - it only governs URLs this guard itself is
  asked to validate before the app fetches them server-side.
*/

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

const DEFAULT_DEV_ALLOWLIST = ["localhost", "127.0.0.1", "::1"];

export type SsrfPolicy = {
  allowLocal: boolean;
  allowedHosts: string[];
};

/*
  Resolved fresh on every call (not cached at module load) so tests can
  flip process.env.NODE_ENV / ALLOW_LOCAL_JOB_URLS / LOCAL_JOB_URL_ALLOWLIST
  between calls. In production this never even reads ALLOW_LOCAL_JOB_URLS -
  there is no code path by which a production request can turn on the
  development exception, regardless of what the environment variable holds.
*/
export function loadSsrfPolicy(): SsrfPolicy {
  if (process.env.NODE_ENV === "production") {
    return { allowLocal: false, allowedHosts: [] };
  }

  const allowLocal = process.env.ALLOW_LOCAL_JOB_URLS === "true";

  if (!allowLocal) {
    return { allowLocal: false, allowedHosts: [] };
  }

  const raw = process.env.LOCAL_JOB_URL_ALLOWLIST;
  const allowedHosts = (raw && raw.trim().length > 0 ? raw : DEFAULT_DEV_ALLOWLIST.join(","))
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return { allowLocal: true, allowedHosts };
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");

  if (parts.length !== 4) return null;

  let value = 0;

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;

    const octet = Number(part);

    if (octet > 255) return null;

    value = (value << 8) | octet;
  }

  return value >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);

  if (ipInt === null || rangeInt === null) return false;

  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;

  return (ipInt & mask) === (rangeInt & mask);
}

const BLOCKED_IPV4_RANGES = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10", // carrier-grade NAT - not in the requested list, but has
  // no legitimate external-job-posting use, so blocking it strictly
  // strengthens the guard without affecting any real job URL.
  "127.0.0.0/8",
  "169.254.0.0/16", // link-local, includes the 169.254.169.254 cloud
  // metadata address requested to be blocked.
  "172.16.0.0/12",
  "192.168.0.0/16",
];

function isPrivateIpv4(ip: string): boolean {
  return BLOCKED_IPV4_RANGES.some((cidr) => ipv4InCidr(ip, cidr));
}

/*
  Minimal IPv6 parser sufficient for the required checks: loopback (::1),
  link-local (fe80::/10), and unique-local (fc00::/7, the IPv6 analogue of
  RFC1918 private space). Also unwraps IPv4-mapped IPv6 addresses
  (::ffff:a.b.c.d) and re-checks the embedded IPv4 address.
*/
function parseIPv6Hextets(ip: string): number[] | null {
  const withoutZone = ip.split("%")[0];

  if (withoutZone.includes(".")) {
    // IPv4-mapped form - not handled by the hextet parser directly.
    return null;
  }

  const halves = withoutZone.split("::");

  if (halves.length > 2) return null;

  const parseGroup = (segment: string): number[] =>
    segment === ""
      ? []
      : segment.split(":").map((h) => parseInt(h, 16));

  if (halves.length === 1) {
    const hextets = parseGroup(halves[0]);
    return hextets.length === 8 && hextets.every((h) => !Number.isNaN(h)) ? hextets : null;
  }

  const head = parseGroup(halves[0]);
  const tail = parseGroup(halves[1]);
  const missing = 8 - head.length - tail.length;

  if (missing < 0) return null;

  const hextets = [...head, ...Array(missing).fill(0), ...tail];

  return hextets.length === 8 && hextets.every((h) => !Number.isNaN(h)) ? hextets : null;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (normalized === "::1") return true;

  const ipv4MappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);

  if (ipv4MappedMatch) {
    return isPrivateIpv4(ipv4MappedMatch[1]);
  }

  const hextets = parseIPv6Hextets(normalized);

  if (!hextets) return true; // fail closed on anything unparseable

  const first = hextets[0];

  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local

  return false;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);

  return true; // not a recognizable IP literal - fail closed
}

/*
  Validates a single URL (one hop). Callers that follow redirects must call
  this again on each redirect target with an incrementing `hop`, and stop
  after maxHops - this function itself does not follow redirects.
*/
export async function assertSafeJobUrl(
  rawUrl: string,
  hop = 0,
  maxHops = 5
): Promise<URL> {
  if (hop > maxHops) {
    throw new UnsafeUrlError("Too many redirects.");
  }

  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("Invalid URL.");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UnsafeUrlError("Only http/https URLs are allowed.");
  }

  const hostname = url.hostname.toLowerCase();
  const policy = loadSsrfPolicy();

  if (policy.allowLocal && policy.allowedHosts.includes(hostname)) {
    return url;
  }

  const version = isIP(hostname);

  let candidates: string[];

  if (version) {
    candidates = [hostname];
  } else {
    try {
      const results = await dns.lookup(hostname, { all: true });
      candidates = results.map((r) => r.address);
    } catch {
      throw new UnsafeUrlError("Could not resolve host.");
    }
  }

  if (candidates.length === 0) {
    throw new UnsafeUrlError("Could not resolve host.");
  }

  if (candidates.some(isPrivateOrReservedIp)) {
    throw new UnsafeUrlError(
      "This URL points to a private or internal address."
    );
  }

  return url;
}
