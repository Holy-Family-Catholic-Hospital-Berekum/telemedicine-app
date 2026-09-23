// hooks/useWeeklyMetrics.js
//
// Shared by OverviewPanel and MetricsPanel so both derive the same
// "consultations by day, OPD vs Surgical" bars from one place instead
// of duplicating the bucketing logic.
//
// Derived client-side from the anonymised `consultationHistory` feed —
// no separate aggregate collection exists yet. Fine while history stays
// small; if it grows large, move this into a Cloud Function / a
// precomputed daily-rollup doc instead of scanning the full collection
// in the browser on every render.
//
// ASSUMPTION: `type` on a history entry is one of "General OPD" /
// "Surgical" — adjust OPD_TYPES below if your actual values differ.

import { useMemo } from "react";

const OPD_TYPES = new Set(["General OPD", "OPD"]);
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function useWeeklyMetrics(history) {
  return useMemo(() => {
    const now = new Date();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push({
        day: DAY_LABELS[d.getDay()],
        key: d.toDateString(),
        opd: 0,
        surgical: 0,
      });
    }
    const byKey = new Map(days.map((d) => [d.key, d]));

    for (const h of history) {
      const ended = h.endedAt ? new Date(h.endedAt) : null;
      if (!ended) continue;
      const bucket = byKey.get(ended.toDateString());
      if (!bucket) continue; // outside the last 7 days
      if (OPD_TYPES.has(h.type)) bucket.opd += 1;
      else bucket.surgical += 1;
    }

    return days;
  }, [history]);
}
