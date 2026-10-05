import { ChevronLeft, ChevronRight } from "lucide-react";

// Page controls for any list (admin tables, patient history, open slots).
// Pair with usePagination (./usePagination.js). For collections that can
// grow without limit, load a bounded window from Firestore first
// (admin/hooks/useWindowedCollection.js) and paginate that.

/**
 * <Pagination {...usePagination(...)} noun="patients" />
 * Hidden when everything fits on one page. `size="lg"` for patient pages.
 */
export function Pagination({ page, pageCount, total, from, to, setPage, noun = "items", size = "md" }) {
  if (pageCount <= 1) return null;
  const big = size === "lg";
  const btn = `inline-flex items-center gap-1 rounded-md border border-[#C9D6DE] bg-white font-medium text-[#12242C] transition hover:border-[#0095D9] disabled:cursor-not-allowed disabled:opacity-40 ${
    big ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
  }`;
  return (
    <nav
      className={`flex flex-wrap items-center justify-between gap-3 ${big ? "mt-5" : "mt-3 px-1"}`}
      aria-label={`${noun} pages`}
    >
      <p className={big ? "text-base text-[#3E4E56]" : "text-sm text-[#5C6B72]"}>
        {from}–{to} of {total} {noun}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} onClick={() => setPage(page - 1)} disabled={page <= 1}>
          <ChevronLeft size={big ? 18 : 15} /> Previous
        </button>
        <span className={big ? "text-base text-[#3E4E56]" : "text-sm text-[#5C6B72]"}>
          Page {page} of {pageCount}
        </span>
        <button type="button" className={btn} onClick={() => setPage(page + 1)} disabled={page >= pageCount}>
          Next <ChevronRight size={big ? 18 : 15} />
        </button>
      </div>
    </nav>
  );
}

/**
 * "Load older" for a windowed Firestore list: shown while the window is
 * full (there may be more records in the database).
 */
export function LoadOlder({ canLoadMore, loading, onLoadMore, loaded, noun = "records", size = "md" }) {
  if (!canLoadMore) return null;
  const big = size === "lg";
  return (
    <div className={`flex flex-wrap items-center gap-3 ${big ? "mt-4" : "mt-3 px-1"}`}>
      <span className={big ? "text-base text-[#3E4E56]" : "text-sm text-[#5C6B72]"}>
        Showing the latest {loaded} {noun}. Search and filters cover these.
      </span>
      <button
        type="button"
        onClick={onLoadMore}
        disabled={loading}
        className={`rounded-md border border-[#0095D9] font-medium text-[#0095D9] transition hover:bg-[#0095D9]/5 disabled:opacity-50 ${
          big ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
        }`}
      >
        {loading ? "Loading…" : `Load older ${noun}`}
      </button>
    </div>
  );
}
