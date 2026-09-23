// hooks/useOutcomeBreakdown.js
import { useMemo } from "react";

const OUTCOME_COLORS = {
  Completed: "var(--color-primary)",
  Cancelled: "var(--color-danger)",
  "No-show": "var(--color-warning)",
};

export function useOutcomeBreakdown(history) {
  return useMemo(() => {
    const counts = new Map();
    for (const h of history) {
      const label = h.outcome || "Unknown";
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([label, value]) => ({
      label,
      value,
      color: OUTCOME_COLORS[label] || "var(--color-ink-faint)",
    }));
  }, [history]);
}
