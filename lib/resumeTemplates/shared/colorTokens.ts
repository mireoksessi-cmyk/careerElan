/*
  Phase 6F - per-template color token sets. Professional ATS v1's
  existing HTML/PDF renderer hardcodes a single monochrome color
  (#111111, see professionalAtsHtml/htmlDocument.ts) - none of the four
  directories audited before this round define any color system, so
  this is genuinely new. Each palette below is deliberately chosen for
  its template's stated audience (spec section 3), not a shared
  generic gray - kept to a restrained 1-accent-color budget per
  template so the accent never fights legibility in a document meant
  to be read/printed/ATS-parsed, not "designed" in the marketing sense.
*/
import type { TemplateId } from "../contracts/types";

export type ColorTokens = {
  text: string;
  heading: string;
  muted: string;
  accent: string;
  border: string;
  background: string;
  sidebarBackground?: string;
  sidebarText?: string;
};

/* Near-black on white, a single restrained slate accent used only for
   the thin section-divider rule - stays effectively monochrome under
   grayscale printing/ATS parsing, matching this template's own stated
   "단색 또는 매우 제한된 accent" requirement. */
export const PROFESSIONAL_ATS_COLORS: ColorTokens = {
  text: "#1a1a1a",
  heading: "#0f0f0f",
  muted: "#4a4a4a",
  accent: "#3b4a5a",
  border: "#c9c9c9",
  background: "#ffffff",
};

/* A deep indigo sidebar against off-white main content - contemporary
   without relying on the generic purple-gradient-on-white look; the
   sidebar's own text is a warm off-white, never pure #fff on pure
   accent, to stay legible when printed in grayscale. */
export const MODERN_SIDEBAR_COLORS: ColorTokens = {
  text: "#232323",
  heading: "#151515",
  muted: "#5b5b5b",
  accent: "#2f5233",
  border: "#dcdcdc",
  background: "#ffffff",
  sidebarBackground: "#1f2a24",
  sidebarText: "#eef1ee",
};

/* Charcoal-on-cream, a single burnished gold-brown rule under the
   name - reads as understated seniority rather than a bright "brand"
   color; kept to a single hairline use, never a fill. */
export const EXECUTIVE_MINIMAL_COLORS: ColorTokens = {
  text: "#22201d",
  heading: "#161412",
  muted: "#5a564f",
  accent: "#7a5a2e",
  border: "#d8d2c4",
  background: "#fdfcf9",
};

/* Deep plum sidebar with a warm coral timeline accent - the one
   template explicitly allowed to look visually distinctive (spec
   section 3: "ATS 친화도는 Professional ATS보다 낮다") while the
   coral marker/line never overlaps or sits behind actual text (see
   templates/creativeTimeline/html.tsx's own layering notes). */
export const CREATIVE_TIMELINE_COLORS: ColorTokens = {
  text: "#241f2b",
  heading: "#161221",
  muted: "#5c5566",
  accent: "#d1603d",
  border: "#e2dbe8",
  background: "#ffffff",
  sidebarBackground: "#332742",
  sidebarText: "#f2ecf7",
};

export const COLOR_TOKENS_BY_TEMPLATE: Record<TemplateId, ColorTokens> = {
  "professional-ats": PROFESSIONAL_ATS_COLORS,
  "modern-sidebar": MODERN_SIDEBAR_COLORS,
  "executive-minimal": EXECUTIVE_MINIMAL_COLORS,
  "creative-timeline": CREATIVE_TIMELINE_COLORS,
};
