import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Refresh from Power BI every morning (13:00 UTC = 6am PT).
crons.daily(
  "refresh revenue data",
  { hourUTC: 13, minuteUTC: 0 },
  internal.refresh.refreshData,
);

// Weekly/monthly Insight cadence snapshots (Shyam, 2026-09-23): same
// questions as the daily Business Feed, tracked on a controlled cadence so
// FACT/INFERENCE/EVIDENCE/CONFIDENCE/ACTION/STATUS can be compared across
// time windows. Runs after the daily refresh so the live window is current.
crons.weekly(
  "weekly insight snapshot",
  { dayOfWeek: "monday", hourUTC: 13, minuteUTC: 45 },
  internal.refresh.weeklySnapshotTick,
);

crons.monthly(
  "monthly insight snapshot",
  { day: 1, hourUTC: 14, minuteUTC: 0 },
  internal.refresh.monthlySnapshotTick,
);

export default crons;
