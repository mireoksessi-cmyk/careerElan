import type { ProvinceOrTerritory } from "./provinces";

/*
  Canadian Metro Area grouping (approximating Statistics Canada's Census
  Metropolitan Area boundaries) used for the "Local Search" tiered
  fallback: exact city -> metro area -> province -> Canada. Per the
  feature spec, metro-area grouping is used INSTEAD of a real distance
  calculation (no per-event geocoordinates exist anywhere in this
  schema - see recommend/route.ts's pre-existing "known limitation" note
  on this) - a fixed, curated grouping is both simpler and more honest
  than a fake "within 100km" number computed from city-name string
  matching alone.

  City names here must exactly match the canonical `city` values written
  by the source registry (sources.ts) - e.g. "Toronto", "Montreal" (no
  accent, matching what's actually in career_fairs.city today), "St.
  John's". Only member cities relevant to this feature (the 40 named in
  the source-expansion spec, the 5 explicitly detailed fallback examples,
  and every city already present in the source registry) are covered -
  not an exhaustive list of all ~35 Canadian CMAs.
*/
export type MetroArea = {
  id: string;
  name: string;
  province: ProvinceOrTerritory;
  cities: string[];
};

export const METRO_AREAS: MetroArea[] = [
  {
    id: "gta",
    name: "Greater Toronto Area",
    province: "Ontario",
    cities: [
      "Toronto",
      "Mississauga",
      "Brampton",
      "Markham",
      "Vaughan",
      "Richmond Hill",
      "Oakville",
      "Burlington",
      "Ajax",
      "Pickering",
      "Whitby",
      "Oshawa",
    ],
  },
  {
    id: "metro-vancouver",
    name: "Metro Vancouver",
    province: "British Columbia",
    cities: [
      "Vancouver",
      "Burnaby",
      "Richmond",
      "Surrey",
      "New Westminster",
      "North Vancouver",
      "Coquitlam",
      "Delta",
      "Langley",
      "Port Coquitlam",
      "Port Moody",
      "White Rock",
    ],
  },
  {
    id: "calgary-metro",
    name: "Calgary Metropolitan Region",
    province: "Alberta",
    cities: ["Calgary", "Airdrie", "Okotoks", "Cochrane", "Chestermere"],
  },
  {
    id: "edmonton-metro",
    name: "Edmonton Metropolitan Region",
    province: "Alberta",
    cities: [
      "Edmonton",
      "St. Albert",
      "Sherwood Park",
      "Spruce Grove",
      "Leduc",
      "Fort Saskatchewan",
    ],
  },
  {
    id: "montreal-metro",
    name: "Greater Montreal",
    province: "Quebec",
    cities: ["Montreal", "Laval", "Longueuil", "Brossard", "Terrebonne", "Repentigny"],
  },
  {
    id: "ottawa-gatineau",
    name: "Ottawa-Gatineau",
    province: "Ontario",
    cities: ["Ottawa", "Gatineau", "Kanata", "Orleans"],
  },
  {
    id: "kw-cambridge",
    name: "Kitchener-Cambridge-Waterloo",
    province: "Ontario",
    cities: ["Kitchener", "Waterloo", "Cambridge"],
  },
  {
    id: "hamilton-metro",
    name: "Hamilton",
    province: "Ontario",
    cities: ["Hamilton", "Burlington", "Grimsby"],
  },
  {
    id: "london-metro",
    name: "London",
    province: "Ontario",
    cities: ["London", "St. Thomas"],
  },
  {
    id: "victoria-metro",
    name: "Greater Victoria",
    province: "British Columbia",
    cities: [
      "Victoria",
      "Saanich",
      "Oak Bay",
      "Esquimalt",
      "Langford",
      "Colwood",
      "Sidney",
    ],
  },
  {
    id: "halifax-metro",
    name: "Halifax Regional Municipality",
    province: "Nova Scotia",
    cities: ["Halifax", "Dartmouth", "Bedford", "Sackville"],
  },
  {
    id: "winnipeg-metro",
    name: "Winnipeg Capital Region",
    province: "Manitoba",
    cities: ["Winnipeg", "East St. Paul", "West St. Paul", "Selkirk"],
  },
  {
    id: "saskatoon-metro",
    name: "Saskatoon",
    province: "Saskatchewan",
    cities: ["Saskatoon", "Warman", "Martensville"],
  },
  {
    id: "regina-metro",
    name: "Regina",
    province: "Saskatchewan",
    cities: ["Regina", "White City"],
  },
  {
    id: "quebec-city-metro",
    name: "Quebec City",
    province: "Quebec",
    cities: ["Quebec City", "Levis"],
  },
  {
    id: "fredericton-metro",
    name: "Fredericton",
    province: "New Brunswick",
    cities: ["Fredericton", "Oromocto"],
  },
  {
    id: "moncton-metro",
    name: "Greater Moncton",
    province: "New Brunswick",
    cities: ["Moncton", "Dieppe", "Riverview"],
  },
  {
    id: "st-johns-metro",
    name: "St. John's",
    province: "Newfoundland and Labrador",
    cities: ["St. John's", "Mount Pearl", "Paradise"],
  },
  {
    id: "kelowna-metro",
    name: "Kelowna",
    province: "British Columbia",
    cities: ["Kelowna", "West Kelowna"],
  },
  {
    id: "windsor-metro",
    name: "Windsor",
    province: "Ontario",
    cities: ["Windsor", "LaSalle", "Tecumseh"],
  },
  {
    id: "kingston-metro",
    name: "Kingston",
    province: "Ontario",
    cities: ["Kingston"],
  },
  {
    id: "barrie-metro",
    name: "Barrie",
    province: "Ontario",
    cities: ["Barrie", "Innisfil"],
  },
  {
    id: "guelph-metro",
    name: "Guelph",
    province: "Ontario",
    cities: ["Guelph"],
  },
  {
    id: "red-deer-metro",
    name: "Red Deer",
    province: "Alberta",
    cities: ["Red Deer"],
  },
  {
    id: "lethbridge-metro",
    name: "Lethbridge",
    province: "Alberta",
    cities: ["Lethbridge"],
  },
];

export function findMetroAreaForCity(city: string | null | undefined): MetroArea | null {
  if (!city) return null;
  const normalized = city.trim().toLowerCase();
  if (!normalized) return null;
  return (
    METRO_AREAS.find((metro) =>
      metro.cities.some((c) => c.toLowerCase() === normalized)
    ) || null
  );
}

const COMBINING_DIACRITICAL_MARKS = new RegExp(
  `[\\u${(0x0300).toString(16).padStart(4, "0")}-\\u${(0x036f).toString(16).padStart(4, "0")}]`,
  "g"
);

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(COMBINING_DIACRITICAL_MARKS, "");
}

/*
  Boroughs amalgamated into a single-tier city (Toronto's 1998
  amalgamation of North York/Scarborough/Etobicoke/York/East York,
  Halifax's 1996 regional-municipality merger) are treated as exact
  aliases of that city rather than metro-tier neighbours - a real event
  ingested with city="Toronto" IS the correct exact match for someone in
  Scarborough, since Scarborough has had no separate municipal government
  (and no source in this registry would ever independently set
  city="Scarborough"). "GTA" itself has no single canonical city, so it's
  aliased to Toronto as the most useful practical default.
*/
const CITY_ALIASES: Record<string, string> = {
  "north york": "Toronto",
  scarborough: "Toronto",
  etobicoke: "Toronto",
  york: "Toronto",
  "east york": "Toronto",
  "downtown toronto": "Toronto",
  gta: "Toronto",
  yyz: "Toronto",
  yvr: "Vancouver",
  yyc: "Calgary",
  yeg: "Edmonton",
  yow: "Ottawa",
  yul: "Montreal",
  dartmouth: "Halifax",
  bedford: "Halifax",
  "quebec city": "Quebec City",
  quebec: "Quebec City",
  "st johns": "St. John's",
  "st. john's": "St. John's",
};

const PROVINCE_CODE_SUFFIX =
  /\s+(on|bc|ab|sk|mb|qc|ns|nb|pe|pei|nl|yt|nt|nu)\.?$/i;

/*
  Resolves free-text city input (any case, with or without a trailing
  province code like "Ottawa ON", with or without French accents like
  "Montréal") down to the canonical city string used throughout this
  feature's DB rows and MetroArea definitions above. Returns the trimmed
  original input, title-cased, when nothing in the alias table matches -
  never invents a city that isn't what the user actually typed.
*/
export function normalizeCityName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const asciiLower = stripDiacritics(trimmed).toLowerCase();
  if (CITY_ALIASES[asciiLower]) return CITY_ALIASES[asciiLower];

  const withoutProvinceCode = asciiLower.replace(PROVINCE_CODE_SUFFIX, "").trim();
  if (withoutProvinceCode !== asciiLower) {
    if (CITY_ALIASES[withoutProvinceCode]) return CITY_ALIASES[withoutProvinceCode];
    return titleCase(withoutProvinceCode);
  }

  return titleCase(asciiLower);
}

function titleCase(lower: string): string {
  return lower
    .split(" ")
    .map((word) =>
      word
        .split("-")
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
        .join("-")
    )
    .join(" ");
}

/*
  0 = exact city match, 1 = same metro area, null = neither. Used by both
  the search page (to decide which rows even qualify once a city filter
  is active) and the recommend endpoint (as part of its scoring formula,
  see recommend/route.ts).
*/
export function cityTierRank(
  fairCity: string | null,
  canonicalSearchCity: string,
  metro: MetroArea | null
): 0 | 1 | null {
  if (!fairCity) return null;
  if (fairCity.toLowerCase() === canonicalSearchCity.toLowerCase()) return 0;
  if (metro && metro.cities.some((c) => c.toLowerCase() === fairCity.toLowerCase())) {
    return 1;
  }
  return null;
}
