// hooks/useWindowedCollection.js
//
// A live Firestore list that only ever loads a bounded window of the most
// recent records (`limit(n)`), growing by `step` when the admin asks for
// older ones. Keeps reads and memory bounded however large the collection
// gets, while search and filters still work over everything loaded.
//
//   const users = useWindowedCollection(
//     (n) => query(collection(db, "users"), orderBy("createdAt", "desc"), limit(n)),
//     500,
//   );
//   users.data, users.loading, users.error, users.canLoadMore, users.loadMore()
//
// `makeQuery` must be stable (define it outside the component or wrap it
// in useCallback).

import { useMemo, useState } from "react";
import { useFirestoreCollection } from "./useFirestoreCollection.js";

export function useWindowedCollection(makeQuery, step = 500) {
  const [size, setSize] = useState(step);
  const ref = useMemo(() => (makeQuery ? makeQuery(size) : null), [makeQuery, size]);
  const { data, loading, error } = useFirestoreCollection(ref);
  // Keep showing the previous rows while a bigger window loads.
  const [last, setLast] = useState({ data: [], size: 0 });
  if (!loading && data !== last.data) setLast({ data, size });
  const shown = loading ? last.data : data;
  return {
    data: shown,
    loading,
    error,
    loaded: shown.length,
    canLoadMore: !loading && data.length >= size,
    loadMore: () => setSize((n) => n + step),
  };
}
