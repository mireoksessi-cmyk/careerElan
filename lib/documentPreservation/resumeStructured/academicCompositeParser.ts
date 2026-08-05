/*
  Phase 5D.3D - Generic Academic Composite Parsing & Full Resume Engine
  Capability Audit. Problem B: Institution/Organization + Location
  combined on ONE line via a delimiter this codebase didn't previously
  recognize (pipe, middle dot, bullet, parenthetical) - "Example
  University | Toronto, ON" was staying one undivided institution
  string, or (a real 5D.3C-confirmed limitation) a whole pipe-joined
  line getting mis-swallowed entirely into `location` because the
  existing looksLikeLocation() only inspects the LAST comma-part,
  regardless of what precedes it.

  This module does NOT replace splitOrganizationLocation.ts (used by
  experienceExtractor.ts for Experience organization/location, a
  different context with its own real-fixture evidence) - it ADDS the
  delimiter forms Academic contexts need, and falls back to
  splitOrganizationLocation's own proven dash/trailing-comma logic when
  no pipe/dot/bullet/parenthetical split is justified, so dash and
  comma behavior stays identical to before for every existing caller.

  Confidence-first, never invents a split: exactly like
  splitOrganizationLocation.ts's own "확신이 없으면 절대 분리하지
  않는다" convention, a delimiter's mere PRESENCE is never enough - the
  segment after it must independently look like a real location
  (looksLikeLocation) before any split happens. "Research & Development
  Institute" (no location-shaped segment anywhere) stays one whole
  string, unsplit, regardless of context.
*/
import { looksLikeLocation, splitOrganizationLocation } from "./splitOrganizationLocation";

export type InlineCompositeContext = "organization" | "education" | "credential" | "award" | "publication" | "training";

/*
  Pipe / middle dot / bullet / slash - delimiter forms real institution/
  organization header lines use that splitOrganizationLocation.ts does
  not already recognize (that module only knows the 6 dash forms and a
  trailing comma). Deliberately excludes dash and comma here - those
  stay owned by splitOrganizationLocation.ts's own tested logic,
  reused via the fallback below, so this module never duplicates or
  drifts from that behavior. Slash is included here (unlike comma) only
  as a FALLBACK reached after multiAcademicValueParser.ts's own
  multi-institution slash-split already failed (its segmentShapeTest
  requires an institution keyword on the SECOND segment too) - a line
  like "Example University / Toronto, ON" fails that (the second
  segment is location-shaped, not institution-shaped), so it safely
  falls through here where the last-segment-looks-like-a-location gate
  below correctly recognizes it as Institution/Location instead.
*/
const COMPOSITE_DELIMITER_RE = /\s*(?:\||·|•|\/)\s*/g;
/*
  "Institution (City, Country)" - a parenthetical suffix whose content
  independently looks like a location. Distinct from a parenthetical
  QUALIFIER ("Bachelor of Engineering (Co-op)", 5D.3C) - that content
  never looks location-shaped, so it is never touched by this branch.
*/
const PAREN_SUFFIX_RE = /^(.*?)\s*\(([^)]+)\)\s*$/;

export type InlineCompositeResult = {
  /* The institution/organization/authority/venue text - never includes
     the location or (if present) the middle detail segment. */
  primaryText: string;
  /* A middle segment between primaryText and location - "Downtown
     Campus" in "Example Institute | Downtown Campus | Vancouver, BC".
     Never a second institution (that shape is Joint Program, handled
     by multiAcademicValueParser.ts, not here) - always preserved
     verbatim, never dropped, even though EducationEntry/CredentialEntry
     have no dedicated "campus" field (callers fold this into details[]
     rather than inventing a new schema field for a single rare shape). */
  detailText?: string;
  location?: string;
  delimiter?: string;
  confidence: number;
  reasonCodes: string[];
};

export function parseInlineCompositeHeader(text: string, _context: InlineCompositeContext): InlineCompositeResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { primaryText: trimmed, confidence: 0, reasonCodes: ["empty-input"] };

  const parenMatch = trimmed.match(PAREN_SUFFIX_RE);
  if (parenMatch && parenMatch[1].trim().length > 0 && looksLikeLocation(parenMatch[2])) {
    return {
      primaryText: parenMatch[1].trim(),
      location: parenMatch[2].trim(),
      delimiter: "()",
      confidence: 0.75,
      reasonCodes: ["parenthetical-location"],
    };
  }

  const parts = trimmed.split(COMPOSITE_DELIMITER_RE).map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (looksLikeLocation(last)) {
      const detailParts = parts.slice(1, -1);
      return {
        primaryText: parts[0],
        detailText: detailParts.length > 0 ? detailParts.join(" | ") : undefined,
        location: last,
        delimiter: "pipe-dot-bullet",
        confidence: 0.72,
        reasonCodes: ["delimiter-location-split"],
      };
    }
  }

  /* No pipe/dot/bullet/paren split justified - fall back to the
     existing, already-proven dash/trailing-comma logic. splitOrganizationLocation's
     OWN trailing-comma path is deliberately UNconditional (never gated on
     looksLikeLocation) for its native Experience organization/location context,
     where a bare city name after a comma is a common, legitimate shape ("Company,
     Toronto"). Academic institution lines have a real false-positive shape that
     path doesn't guard against - "Example University, School of Business" is one
     institution's own comma-separated sub-unit, not Institution+Location - so this
     module re-gates the comma result on looksLikeLocation before accepting it
     (the dash result is already internally gated by splitOrganizationLocation
     itself and is accepted as-is). Confirmed via the f15 fixture's own
     regression-anchor entry ("Example University, School of Business" /
     "Master of Business Administration"). */
  const fallback = splitOrganizationLocation(trimmed);
  if (fallback.location && looksLikeLocation(fallback.location)) {
    return {
      primaryText: fallback.organization,
      location: fallback.location,
      delimiter: "dash-or-comma",
      confidence: 0.65,
      reasonCodes: ["dash-or-comma-location-split"],
    };
  }

  return { primaryText: trimmed, confidence: 0.5, reasonCodes: ["no-composite-split-justified"] };
}
