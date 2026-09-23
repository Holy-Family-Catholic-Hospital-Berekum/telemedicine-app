// hooks/useFirestoreCollection.js
//
// Thin wrapper around onSnapshot for list-shaped data (doctors,
// bookings, audit log, etc). Pass a memoized Firestore query (wrap it
// in useMemo at the call site — a new query object on every render
// would tear down and resubscribe the listener every render).
//
// Returns { data, loading, error }. `data` is [] until the first
// snapshot arrives (not necessarily "empty" — check `loading` before
// showing an empty state).

import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";

export function useFirestoreCollection(queryRef) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!queryRef) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsubscribe = onSnapshot(
      queryRef,
      (snap) => {
        setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setError(null);
        setLoading(false);
      },
      (err) => {
        // Rules-denied reads, offline, etc. Surface it — don't silently
        // show stale/empty data as if it were current.
        setError(err);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [queryRef]);

  return { data, loading, error };
}
