// usePagination: slices an already-loaded array into pages. The page is
// clamped when the list shrinks (e.g. a search narrows it); pass a new
// `resetKey` (the search text, a filter, a tab) to start again from page 1.
// Render the controls with <Pagination {...pager} /> from ./pagination.jsx.

import { useState } from "react";

export function usePagination(items, pageSize = 25, resetKey = "") {
  const [state, setState] = useState({ page: 1, key: resetKey });
  // A new resetKey (search, filter, tab) starts again from page 1.
  const page = state.key === resetKey ? state.page : 1;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  return {
    page: current,
    pageCount,
    total: items.length,
    from: items.length ? start + 1 : 0,
    to: Math.min(start + pageSize, items.length),
    pageItems: items.slice(start, start + pageSize),
    setPage: (p) => setState({ page: p, key: resetKey }),
  };
}
