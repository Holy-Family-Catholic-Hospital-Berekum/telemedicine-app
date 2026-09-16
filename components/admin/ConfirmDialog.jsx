// Shared confirmation dialog. Used by PaymentsPanel now; the doctor's
// Close Session action (4.6) should reuse this too, since that one is
// irreversible — there are no Firestore backups.
export default function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  onConfirm,
  onClose,
}) {
  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div
        className="admin-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        <p className="sub">{body}</p>

        <div className="admin-modal-actions">
          <button className="btn btn-outline" onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
