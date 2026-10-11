/**
 * Manually curated digital-footprint findings for the clinics that dragged
 * the top-20% cohort the most (OSINT sweep, 2026-09-01). Keyed by clinic_id.
 * Covers the top 100 retained-top-20% decliners by shortfall (of which 36
 * turned up a concrete finding — the rest had no usable public signal and
 * are omitted so the UI shows nothing for them). Confidence is "solid" when
 * a named clinic/person was matched with high certainty, "tentative" when
 * the name is generic or the match is ambiguous.
 */
export type ClinicFootprint = {
  finding: string;
  cause: string;
  confidence: "solid" | "tentative";
};

export const CLINIC_FOOTPRINTS: Record<string, ClinicFootprint> = {
  "124365": {
    finding:
      "Open, active blog; profiled using Doctor's Data GI360 for gut testing.",
    cause: "Competitor lab (gut)",
    confidence: "solid",
  },
  "140855": {
    finding:
      "Not a clinic — Reed Davis's FDN certification program (tuition includes lab screenings); relocated Poway CA to Las Vegas.",
    cause: "Enrollment-cohort timing, not patient traffic",
    confidence: "solid",
  },
  "22106": {
    finding:
      "Open, franchise expanding; pushing its own \"Next Labs\" membership (quarterly panels incl. Wheat Zoomer).",
    cause: "Channel/mix shift inside membership",
    confidence: "solid",
  },
  "23825": {
    finding:
      "Practice visibly thriving — active blog through Jun 2026, \"Top Docs\" press, owner active.",
    cause: "Near-total stop while healthy — probable lab switch (top save call)",
    confidence: "solid",
  },
  "126740": {
    finding: "Footprint too thin to confirm — no active site found.",
    cause: "Unknown — AE verify",
    confidence: "tentative",
  },
  "74614": {
    finding:
      "Several same-name practices; one match uses Labcorp/Quest for bloods.",
    cause: "Ambiguous — AE verify",
    confidence: "tentative",
  },
  "142570": {
    finding:
      "Team still active/hiring, but Chief Wellness Officer Tim Jackson's tenure ended Jul 2026.",
    cause: "Key clinical hire departed + new 35% Canada duty",
    confidence: "solid",
  },
  "139132": {
    finding: "House e-commerce account, not an external practice.",
    cause: "DTC channel volume — check web funnel, not an AE call",
    confidence: "solid",
  },
  "101443": {
    finding:
      "Open (Gilbert/Mesa); live Rupa Health storefront \"Dr. Chad Wellness Testing\" — Vibrant isn't on Rupa.",
    cause: "Competitor channel (Rupa)",
    confidence: "solid",
  },
  "67511": {
    finding:
      "Med-spa medical director (SoVous), licensed in 42 states — likely tele/director volume.",
    cause: "Mixed — verify which entity orders",
    confidence: "tentative",
  },
  "8093": {
    finding:
      "Open, large (17,000 sq ft); owner promotes cheap in-house labs + Boston Heart.",
    cause: "In-sourcing + competitor (cardio)",
    confidence: "solid",
  },
  "130442": {
    finding: "DTC reseller (28 Day Health) — still sells Vibrant kits.",
    cause: "E-com traffic, not defection",
    confidence: "solid",
  },
  "30068": {
    finding: "Open, 7 providers, award-winning 3 years running.",
    cause: "No public signal — internal mix",
    confidence: "solid",
  },
  "133025": {
    finding: "Open; running its own clinical research (Apr 2026).",
    cause: "No public signal",
    confidence: "solid",
  },
  "19079": {
    finding:
      "Open and expanding (Apr 2026); sells GI-MAP (Diagnostic Solutions) via Rupa Lab Shop.",
    cause: "Competitor lab (gut) despite growth",
    confidence: "solid",
  },
  "31250": {
    finding:
      "Open, multi-site; promotes Mosaic/Great Plains MycoTOX for mold + HealthLab for insured bloods.",
    cause: "Competitor lab (tox)",
    confidence: "solid",
  },
  "129655": {
    finding: "Open, growing, recent expansion.",
    cause: "No public signal — pacing",
    confidence: "solid",
  },
  "43712": {
    finding: "Growing +70% YoY; actively sells Cardio Zoomer (Vibrant) on its shop.",
    cause: "Still committed — pacing/mix",
    confidence: "solid",
  },
  "136694": {
    finding:
      "Pivoting to peptides (certification program, podcast circuit); negative press Aug 17, 2026.",
    cause: "Model pivot away from testing",
    confidence: "solid",
  },
  "40989": {
    finding:
      "Open, 9 NDs, 4.9★ rating; acquired by NorthBridge PE (Mar 2024); offers in-house Vega testing.",
    cause: "Ownership change → purchasing shift",
    confidence: "solid",
  },
  "136237": {
    finding:
      "Still sells Vibrant kits, but OAT switched to Mosaic; checkout discloses a new 35% Canada duty.",
    cause: "Duty shock + partial competitor shift",
    confidence: "solid",
  },
  "150476": {
    finding: "Small family clinic (est. 1990), open.",
    cause: "No public signal — AE verify",
    confidence: "tentative",
  },
  "48119": {
    finding: "Open, active socials; shop FAQ references Vibrant lab kits.",
    cause: "Still committed — pacing",
    confidence: "solid",
  },
  "8120": {
    finding:
      "Not a clinic — Reed Davis's FDN certification program (Las Vegas HQ).",
    cause: "Enrollment-cohort timing, not patient traffic",
    confidence: "solid",
  },
  "8474": {
    finding:
      "Co-founder/medical director Jeoff Drobot left — now runs competing BioMed Center Scottsdale.",
    cause: "Practice split — volume may have moved with him (win-back/new-logo target)",
    confidence: "solid",
  },

  // --- Batch 2: extended to top-100 decliners, 2026-09-01 ---
  "13658": {
    finding:
      "Active practice; utilizes Doctor's Data for essential elements testing.",
    cause: "Competitor lab (Doctor's Data)",
    confidence: "solid",
  },
  "124602": {
    finding:
      "Complete Medical Recovery expanded in Yorkville, Illinois, moving into a larger new location that includes a fitness studio and supplement store.",
    cause: "Practice expansion",
    confidence: "solid",
  },
  "32894": {
    finding:
      "Active clinic in Reston, VA; LinkedIn presence references partnership with Function Health.",
    cause: "Competitor lab",
    confidence: "tentative",
  },
  "126506": {
    finding:
      "Practice was acquired by Forum Health in 2022 and subsequently expanded to a second location.",
    cause: "Practice acquired",
    confidence: "solid",
  },
  "124546": {
    finding:
      "Active 10-year-old practice in St. Louis; utilizes Quest for standard labs alongside preferred Vibrant Labs.",
    cause: "Competitor lab",
    confidence: "solid",
  },
  "72430": {
    finding:
      "Active functional medicine practice led by Dr. Elliot Dinetz; utilizes Diagnostic Solutions GI-MAP DNA PCR testing for gut health evaluations.",
    cause: "Competitor lab (gut)",
    confidence: "solid",
  },
  "35285": {
    finding:
      "Healing Generations was purchased by Arbor Health Functional Medicine and Psychiatry.",
    cause: "Practice acquired",
    confidence: "solid",
  },
  "10145": {
    finding:
      "Open, active clinic in Sarasota, FL; utilizes Quest Diagnostics for routine blood work alongside specialized testing.",
    cause: "Competitor lab (Quest)",
    confidence: "solid",
  },
  "125019": {
    finding:
      "Doctor holds a Functional Medicine Diagnostics Certification from Genova Labs.",
    cause: "Competitor lab (Genova)",
    confidence: "solid",
  },
  "124395": {
    finding:
      "Active practice publishing patient instructions for Genova Diagnostics Metabolomix+ testing.",
    cause: "Competitor lab",
    confidence: "solid",
  },
  "134277": {
    finding:
      "Active practice; utilizes Genova Diagnostics for stool and hormone testing alongside Vibrant Wellness.",
    cause: "Competitor lab (gut)",
    confidence: "solid",
  },
};
