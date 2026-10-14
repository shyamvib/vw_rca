import { v } from "convex/values";
import { scopedAction } from "./gated";
import { eq, O, ordersRows, rows as cubeRows } from "./cube";
import { TABLE } from "./powerbi";

/** Per-clinic touch mix for the new-clinic Sankey (Shyam, 2026-10-13):
 * calls / meetings (touchpoint_type) and clinical consult / VCT (training)
 * from customer_journey_final, all-time, joined via orders' hubspot_id. */
export const newClinicTouches = scopedAction({
  args: { clinics: v.array(v.string()) },
  handler: async (_ctx, { clinics }) => {
    const ids = clinics.filter(c => /^\d+$/.test(c)).slice(0, 2000);
    const out: Record<string, { call: number; meeting: number; consult: number; vct: number; ev?: { d: string; k: "call" | "meeting" | "consult" | "vct" }[] }> = {};
    if (!ids.length) return out;
    const map = await ordersRows({ by: ["clinic_id", "hubspot_id"], m: { ord: "orders" }, filters: [eq(`${O}.clinic_id`, ...ids)] });
    const clinicOf = new Map<string, string>();
    for (const r of map) {
      const h = String(r[`${TABLE}[hubspot_id]`] ?? "");
      if (h) clinicOf.set(h, String(r[`${TABLE}[clinic_id]`]));
    }
    if (!clinicOf.size) return out;
    const hs = [...clinicOf.keys()].filter(h => /^\d+$/.test(h));
    const rows = await cubeRows({
      measures: ["journey.touchpoints"],
      dimensions: ["journey.contact_id", "journey.touchpoint_type", "journey.touchpoint_category", "journey.activity_type"],
      timeDimensions: [{ dimension: "journey.touchpoint_date", granularity: "day" }],
      filters: [eq("journey.contact_id", ...hs)],
    }, {
      "journey.contact_id": "customer_journey_final[contact_id]",
      "journey.touchpoint_type": "customer_journey_final[touchpoint_type]",
      "journey.touchpoint_category": "customer_journey_final[touchpoint_category]",
      "journey.activity_type": "customer_journey_final[activityType]",
      "journey.touchpoint_date": "customer_journey_final[touchpoint_date]",
      "journey.touchpoints": "[n]",
    });
    for (const r of rows) {
      const c = clinicOf.get(String(r["customer_journey_final[contact_id]"] ?? ""));
      if (!c) continue;
      const o = (out[c] ??= { call: 0, meeting: 0, consult: 0, vct: 0 });
      const n = Number(r["[n]"] ?? 0);
      const type = String(r["customer_journey_final[touchpoint_type]"] ?? "");
      const cat = String(r["customer_journey_final[touchpoint_category]"] ?? "");
      const act = String(r["customer_journey_final[activityType]"] ?? "");
      const k = cat === "Clinical Activity" && /consult/i.test(act) ? "consult"
        : cat === "Clinical Activity" && /training/i.test(act) ? "vct"
        : type === "Meeting" ? "meeting" : type === "Call" ? "call" : null;
      if (!k) continue;
      o[k] += n;
      const d = String(r["customer_journey_final[touchpoint_date]"] ?? "").slice(0, 10);
      if (d) (o.ev ??= []).push({ d, k });
    }
    return out;
  },
});
