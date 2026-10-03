// hooks/useOutcomeBreakdown.js
import { useMemo } from "react";

import { OUTCOME_LABELS } from "../../../src/constants";

const OUTCOME_COLORS = {
  completed: "var(--color-primary)",
  no_show: "var(--color-warning)",
};

export function useOutcomeBreakdown(history) {
  return useMemo(() => {
    const counts = new Map();
    for (const h of history) {
      const key = h.outcome || "unknown";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([key, value]) => ({
      label: OUTCOME_LABELS[key] || "Unknown",
      value,
      color: OUTCOME_COLORS[key] || "var(--color-ink-faint)",
    }));
  }, [history]);
}
