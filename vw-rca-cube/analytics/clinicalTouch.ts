import { v } from "convex/values";
import { scopedAction } from "./gated";
import { eq, O, rows as cubeRows } from "./cube";

/** Clinical consult / training touchpoints for one clinic or provider
 * (Shyam, 2026-09-29, search cards; he confirmed training = VCT). Source: customer_journey_final rows with
 * touchpoint_category = "Clinical Activity", all-time. "Consult" = activityType
 * containing "consult"; "Training" = activityType containing "training"
 * (candidate for VCT — no literal "VCT" value exists in the model). */
export const clinicalTouch = scopedAction({
  args: { clinic: v.optional(v.string()), provider: v.optional(v.string()) },
  handler: async (_ctx, { clinic, provider }) => {
    const id = provider ?? clinic;
    if (!id || !/^\d+$/.test(id)) return { consult: null, training: null };
    const col = provider ? "customer_id" : "clinic_id";
    // Step 1: the HubSpot contact ids behind this clinic / provider.
    const idRows = await cubeRows(
      {
        dimensions: [`${O}.hubspot_id`],
        filters: [eq(`${O}.${col}`, id), { member: `${O}.hubspot_id`, operator: "set" }],
      },
      { [`${O}.hubspot_id`]: "id" },
    );
    const ids = [...new Set(idRows.map(r => String(r.id ?? "")).filter(Boolean))];
    if (!ids.length) return { consult: null, training: null };
    // Step 2: their Clinical Activity touchpoints, all-time.
    const rows = await cubeRows(
      {
        measures: ["journey.last_touch", "journey.touchpoints"],
        dimensions: ["journey.activity_type"],
        filters: [eq("journey.contact_id", ...ids), eq("journey.touchpoint_category", "Clinical Activity")],
      },
      {
        "journey.activity_type": "customer_journey_final[activityType]",
        "journey.last_touch": "[last]",
        "journey.touchpoints": "[n]",
      },
    );
    const agg = (re: RegExp) => {
      let last = "", n = 0;
      for (const r of rows) {
        if (!re.test(String(r["customer_journey_final[activityType]"] ?? ""))) continue;
        n += Number(r["[n]"] ?? 0);
        const d = String(r["[last]"] ?? "").slice(0, 10);
        if (d > last) last = d;
      }
      return n ? { n, last } : null;
    };
    return { consult: agg(/consult/i), training: agg(/training/i) };
  },
});
