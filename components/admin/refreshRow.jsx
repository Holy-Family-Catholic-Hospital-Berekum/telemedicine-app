// "Updated 14:05  [Refresh]" for figures computed by the database
// (hooks/useServerTotals.js): they load when the panel opens and on
// Refresh, not live.
export default function RefreshRow({ totals, what = "the figures" }) {
  const time = totals.updatedAt?.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <div className="admin-refresh-row">
        <span className="admin-cell-sub">{totals.loading ? "Loading…" : time ? `Updated ${time}` : ""}</span>
        <button type="button" className="btn btn-outline" onClick={totals.refresh} disabled={totals.loading}>
          Refresh
        </button>
      </div>
      {totals.error && (
        <div className="admin-empty" role="alert">
          Couldn't load {what}. Check the connection and press Refresh.
        </div>
      )}
    </>
  );
}
