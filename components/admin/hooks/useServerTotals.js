// hooks/useServerTotals.js
//
// Admin figures worked out by Firestore itself (count / sum aggregation),
// never by downloading records, so they stay correct however much history
// there is. A count or sum is billed as one read per 1,000 records it
// covers: each refresh costs about 15-20 reads.
//
// Not live: they load when the panel opens and again on Refresh (hospital
// decision, 12 Oct 2026). Bookings lists stay live elsewhere.
//
//   useConsultationStats()        Overview / Metrics: the last 7 days by
//                                 type, and how consultations ended (all time)
//   useRevenueTotals(sinceMs)     Revenue: payments, Paystack charges, by
//                                 type and channel, refunds; null = all time
//
// Each returns { data, error, loading, updatedAt, refresh }.
// Indexes: confirmedPayments type+paidAt and channel+paidAt,
// consultationHistory type+endedAt (firestore.indexes.json).

import { useCallback, useEffect, useState } from "react";
import {
  Timestamp,
  collection,
  count,
  getAggregateFromServer,
  query,
  sum,
  where,
} from "firebase/firestore";
import { db } from "../../../src/firebase";
import { OUTCOME_LABELS } from "../../../src/constants";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const OUTCOME_COLORS = {
  completed: "var(--color-primary)",
  no_show: "var(--color-warning)",
  cancelled: "var(--color-ink-faint)",
};
export const PAYMENT_TYPES = ["OPD", "SURGICAL", "NO_SHOW_FEE", "RESCHEDULE_FEE"];
// Paystack's channel names; anything else is shown as "Other".
export const CHANNELS = ["mobile_money", "card", "bank", "bank_transfer", "ussd", "qr", "apple_pay"];

/** Runs `load` on mount, when `key` changes and on refresh(). */
function useAggregate(load, key) {
  const [tick, setTick] = useState(0);
  const request = `${key}#${tick}`;
  // `for` = the request these figures answer; older figures stay on screen
  // while a newer request loads.
  const [state, setState] = useState({ for: null, data: null, error: null, updatedAt: null });
  useEffect(() => {
    let active = true;
    load()
      .then((data) => active && setState({ for: request, data, error: null, updatedAt: new Date() }))
      .catch((error) => active && setState((s) => ({ ...s, for: request, error })));
    return () => {
      active = false;
    };
    // `load` is rebuilt every render; `request` says when its inputs changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.data, error: state.error, updatedAt: state.updatedAt, loading: state.for !== request, refresh };
}

const num = (snap, field) => Number(snap.data()[field] || 0);

/** Last 7 days (hospital time = UTC) by type, and outcomes all time. */
export function useConsultationStats() {
  return useAggregate(async () => {
    const col = collection(db, "consultationHistory");
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }, (_, i) => new Date(today.getTime() - (6 - i) * DAY_MS));
    const countFor = (type, from) =>
      getAggregateFromServer(
        query(
          col,
          where("type", "==", type),
          where("endedAt", ">=", Timestamp.fromDate(from)),
          where("endedAt", "<", Timestamp.fromMillis(from.getTime() + DAY_MS)),
        ),
        { n: count() },
      ).then((s) => num(s, "n"));
    const outcomeKeys = Object.keys(OUTCOME_LABELS);
    const [perDay, outcomes] = await Promise.all([
      Promise.all(days.map((d) => Promise.all([countFor("OPD", d), countFor("SURGICAL", d)]))),
      Promise.all(
        outcomeKeys.map((k) =>
          getAggregateFromServer(query(col, where("outcome", "==", k)), { n: count() }).then((s) => num(s, "n")),
        ),
      ),
    ]);
    return {
      weekly: days.map((d, i) => ({
        day: DAY_LABELS[d.getUTCDay()],
        key: d.toISOString().slice(0, 10),
        opd: perDay[i][0],
        surgical: perDay[i][1],
      })),
      outcomes: outcomeKeys
        .map((k, i) => ({ label: OUTCOME_LABELS[k], value: outcomes[i], color: OUTCOME_COLORS[k] }))
        .filter((o) => o.value > 0),
    };
  }, "consultations");
}

/** Revenue since `sinceMs` (null = all time). */
export function useRevenueTotals(sinceMs) {
  return useAggregate(async () => {
    const payments = collection(db, "confirmedPayments");
    const since = sinceMs ? [where("paidAt", ">=", Timestamp.fromMillis(sinceMs))] : [];
    const totals = (...filters) =>
      getAggregateFromServer(query(payments, ...filters, ...since), {
        amount: sum("amount"),
        fees: sum("fees"),
        n: count(),
      }).then((s) => ({ amount: num(s, "amount"), fees: num(s, "fees"), count: num(s, "n") }));
    const refunded = (col) =>
      getAggregateFromServer(
        query(
          collection(db, col),
          where("status", "==", "refunded"),
          ...(sinceMs ? [where("refundedAt", ">=", Timestamp.fromMillis(sinceMs))] : []),
        ),
        { amount: sum("amountRefunded"), n: count() },
      ).then((s) => ({ amount: num(s, "amount"), count: num(s, "n") }));

    const [all, types, channels, refunds] = await Promise.all([
      totals(),
      Promise.all(PAYMENT_TYPES.map((t) => totals(where("type", "==", t)))),
      Promise.all(CHANNELS.map((c) => totals(where("channel", "==", c)))),
      Promise.all(["refundRequests", "paymentIssues"].map(refunded)),
    ]);
    const byChannel = CHANNELS.map((c, i) => [c, channels[i]]).filter(([, v]) => v.count > 0);
    const known = byChannel.reduce((t, [, v]) => ({ count: t.count + v.count, amount: t.amount + v.amount }), {
      count: 0,
      amount: 0,
    });
    if (all.count > known.count) {
      byChannel.push(["Other", { count: all.count - known.count, amount: all.amount - known.amount }]);
    }
    return {
      total: all.amount,
      fees: all.fees,
      count: all.count,
      byType: PAYMENT_TYPES.map((t, i) => [t, types[i]]).filter(([, v]) => v.count > 0),
      byChannel: byChannel.sort((a, b) => b[1].amount - a[1].amount),
      refunded: {
        amount: refunds[0].amount + refunds[1].amount,
        count: refunds[0].count + refunds[1].count,
      },
    };
  }, String(sinceMs));
}
