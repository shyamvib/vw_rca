/**
 * Geography keys shared by the map, the RSM rollup and the clinic drill, so a
 * clinic always lands in exactly one geography everywhere in the dashboard.
 */
const COUNTRY_NAME: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  UK: "United Kingdom",
  GB: "United Kingdom",
  AE: "United Arab Emirates",
  AU: "Australia",
  CH: "Switzerland",
  DE: "Germany",
  ES: "Spain",
  FR: "France",
  IE: "Ireland",
  MX: "Mexico",
  PA: "Panama",
  SA: "Saudi Arabia",
  RO: "Romania",
  HU: "Hungary",
  SK: "Slovakia",
  SG: "Singapore",
  ZA: "South Africa",
  DO: "Dominican Republic",
  NZ: "New Zealand",
  PL: "Poland",
  CZ: "Czechia",
  GR: "Greece",
  VI: "U.S. Virgin Islands",
  CO: "Colombia",
  SE: "Sweden",
  JO: "Jordan",
  LT: "Lithuania",
  RU: "Russia",
  IL: "Israel",
  IN: "India",
  IT: "Italy",
  NL: "Netherlands",
  NO: "Norway",
  DK: "Denmark",
  PT: "Portugal",
  BE: "Belgium",
  AT: "Austria",
  BR: "Brazil",
  JP: "Japan",
  KR: "South Korea",
  TR: "Turkey",
  QA: "Qatar",
  KW: "Kuwait",
  PR: "Puerto Rico",
  KY: "Cayman Islands",
  TH: "Thailand",
  PH: "Philippines",
  UM: "U.S. Minor Outlying Islands",
  MY: "Malaysia",
  ID: "Indonesia",
  VN: "Vietnam",
  CL: "Chile",
  AR: "Argentina",
  PE: "Peru",
  EC: "Ecuador",
  CR: "Costa Rica",
  GT: "Guatemala",
  BS: "Bahamas",
  BM: "Bermuda",
  JM: "Jamaica",
  TT: "Trinidad and Tobago",
  EG: "Egypt",
  NG: "Nigeria",
  KE: "Kenya",
  MA: "Morocco",
  LB: "Lebanon",
  BH: "Bahrain",
  OM: "Oman",
  PK: "Pakistan",
  BD: "Bangladesh",
  LK: "Sri Lanka",
  TW: "Taiwan",
  HK: "Hong Kong",
  CN: "China",
  FI: "Finland",
  IS: "Iceland",
  EE: "Estonia",
  LV: "Latvia",
  SI: "Slovenia",
  HR: "Croatia",
  RS: "Serbia",
  BG: "Bulgaria",
  UA: "Ukraine",
  CY: "Cyprus",
  MT: "Malta",
  LU: "Luxembourg",
  MC: "Monaco",
  GU: "Guam",
};

const US_STATE: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", VI: "U.S. Virgin Islands",
};


/** US-state rows use the plain state code so they stay compatible with the
 * tree's geography lens keys; everything else is grouped by country. */
export function geoKeyOf(r: { state: string; country: string }): {
  key: string;
  code: string;
  kind: "state" | "country";
  label: string;
} {
  const country = (r.country || "—").toUpperCase();
  const state = (r.state || "").toUpperCase();
  const isUs = country === "US" || country === "—" || country === "";
  if (isUs && US_STATE[state]) {
    return { key: state, code: state, kind: "state", label: US_STATE[state] };
  }
  if (!isUs) {
    return {
      key: `c:${country}`,
      code: country,
      kind: "country",
      label: COUNTRY_NAME[country] ?? country,
    };
  }
  return {
    key: state || "(blank)",
    code: state || "—",
    kind: "state",
    label: state ? state : "Unknown",
  };
}

