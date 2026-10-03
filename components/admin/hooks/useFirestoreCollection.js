// hooks/useFirestoreCollection.js
//
// Thin wrapper around onSnapshot for list-shaped data (doctors,
// bookings, audit log, etc). Pass a memoized Firestore query (wrap it
// in useMemo at the call site — a new query object on every render
// would tear down and resubscribe the listener every render).
//
// Returns { data, loading, error }. `data` is [] until the first
// snapshot arrives (not necessarily "empty" — check `loading` before
// showing an empty state). Top-level Firestore Timestamps are converted to
// JS Dates so panels can format them directly. Pass null to skip loading.

import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";

function withDates(data) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = value && typeof value.toDate === "function" ? value.toDate() : value;
  }
  return out;
}

const EMPTY = [];

export function useFirestoreCollection(queryRef) {
  // `forQuery` records which query the result belongs to, so `loading` is
  // derived (true until this query's first snapshot) instead of being set
  // synchronously inside the effect.
  const [result, setResult] = useState({ forQuery: null, data: EMPTY, error: null });

  useEffect(() => {
    if (!queryRef) return undefined;
    return onSnapshot(
      queryRef,
      (snap) =>
        setResult({
          forQuery: queryRef,
          data: snap.docs.map((d) => ({ id: d.id, ...withDates(d.data()) })),
          error: null,
        }),
      // Rules-denied reads, offline, etc. Surface it — don't silently
      // show stale/empty data as if it were current.
      (error) => setResult({ forQuery: queryRef, data: EMPTY, error }),
    );
  }, [queryRef]);

  const current = queryRef && result.forQuery === queryRef;
  return {
    data: current ? result.data : EMPTY,
    loading: Boolean(queryRef) && !current,
    error: current ? result.error : null,
  };
}
