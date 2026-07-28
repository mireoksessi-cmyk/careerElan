/*
  Canonical list of all 10 provinces + 3 territories. career_fairs.
  province_or_territory always stores the full English name below - this
  module is the single place that normalizes any other spelling (2-letter
  code, French name, a reverse-geocoder's own naming) into that canonical
  form, so callers never have to duplicate this mapping.
*/
export const CANADIAN_PROVINCES_AND_TERRITORIES = [
  "Alberta",
  "British Columbia",
  "Manitoba",
  "New Brunswick",
  "Newfoundland and Labrador",
  "Northwest Territories",
  "Nova Scotia",
  "Nunavut",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Yukon",
] as const;

export type ProvinceOrTerritory =
  (typeof CANADIAN_PROVINCES_AND_TERRITORIES)[number];

const CODE_TO_PROVINCE: Record<string, ProvinceOrTerritory> = {
  ab: "Alberta",
  bc: "British Columbia",
  mb: "Manitoba",
  nb: "New Brunswick",
  nl: "Newfoundland and Labrador",
  nt: "Northwest Territories",
  ns: "Nova Scotia",
  nu: "Nunavut",
  on: "Ontario",
  pe: "Prince Edward Island",
  qc: "Quebec",
  sk: "Saskatchewan",
  yt: "Yukon",
};

/*
  Alternate spellings seen from geocoders (BigDataCloud's
  principalSubdivision), French names, and common abbreviations - not
  exhaustive, extend as new variants are actually observed.
*/
const ALIAS_TO_PROVINCE: Record<string, ProvinceOrTerritory> = {
  "québec": "Quebec",
  "newfoundland & labrador": "Newfoundland and Labrador",
  "n.w.t.": "Northwest Territories",
  "nwt": "Northwest Territories",
  "p.e.i.": "Prince Edward Island",
  "pei": "Prince Edward Island",
};

export function normalizeProvinceOrTerritory(
  raw: string | null | undefined
): ProvinceOrTerritory | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const exact = CANADIAN_PROVINCES_AND_TERRITORIES.find(
    (p) => p.toLowerCase() === trimmed.toLowerCase()
  );
  if (exact) return exact;

  const byCode = CODE_TO_PROVINCE[trimmed.toLowerCase()];
  if (byCode) return byCode;

  const byAlias = ALIAS_TO_PROVINCE[trimmed.toLowerCase()];
  if (byAlias) return byAlias;

  return null;
}
