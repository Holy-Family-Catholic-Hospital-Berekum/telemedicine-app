// users.jsx
//
// Admin-only user management.
//
// PERMISSION RULE — this is the whole point of the component, so it's
// enforced in exactly one place (isActionable, below) rather than
// scattered across JSX conditions:
//   Admin can deactivate or delete ANY account EXCEPT:
//     1. their own account
//     2. any other admin's account
//   Only patient and doctor rows ever get action buttons. Everything
//   else in the UI follows from that one rule.
//
// This UI-side check is a convenience, not the real gate — the
// deactivate/delete/create-doctor operations themselves MUST re-check
// role and identity server-side (Cloud Functions / Firestore rules),
// since a client can call any function regardless of what buttons are
// rendered here.
//
// ASSUMPTIONS (adjust to match your actual project):
// - Patients self-register via signUp.jsx. Doctors have no public
//   sign-up — per signIn.jsx's own comment, "admin and doctor accounts
//   are created manually by the hospital" — so this screen is the ONLY
//   place a doctor account gets created.
// - Creating a doctor account is a privileged, server-side call (e.g. a
//   Firebase Cloud Function `createDoctorAccount`), NOT a client-side
//   createUserWithEmailAndPassword — that would sign the admin out of
//   their own session and into the new doctor's. The function should
//   create the Auth user, write role: "doctor" to Firestore, and email
//   the doctor an invite/password-set link. This component just calls
//   whatever `onCreateDoctor` prop the parent wires up to that function.
// - `users` is the full account list the parent dashboard already loads,
//   shaped roughly as:
//     { id, name, email, phone, role: "patient" | "doctor" | "admin",
//       status: "active" | "deactivated", specialty?, createdAt }
// - `currentAdminId` is the signed-in admin's own uid/doc id.
// - IconUserX / IconUserCheck / IconTrash / IconPlus / IconAlert: swap
//   for whatever your icons.jsx actually exports if these names don't
//   match — same file as the icons BookingsPanel/PaymentsPanel import.
// - Validators (isValidEmail/isValidPhone/isValidName) reused from
//   signUp.jsx's utils — update the import path if this file doesn't sit
//   at the same depth as bookingsPanel.jsx.

import { useState } from "react";
import ConfirmDialog from "./confirmDialog.jsx";
import {
  IconPlus,
  IconUserX,
  IconUserCheck,
  IconTrash,
  IconAlert,
} from "./icons.jsx";
import {
  isValidEmail,
  isValidPhone,
  isValidName,
} from "../../src/utils/validators.js";

const ROLE_LABELS = {
  patient: "Patient",
  doctor: "Doctor",
  admin: "Admin",
};

function CreateDoctorModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    specialty: "",
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const update = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = () => {
    const errs = {};
    if (!isValidName(form.name)) errs.name = "Enter the doctor's full name.";
    if (!isValidEmail(form.email)) errs.email = "Enter a valid email address.";
    if (!isValidPhone(form.phone)) errs.phone = "Enter a valid phone number.";
    if (!form.specialty.trim()) errs.specialty = "Enter a specialty.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!validate()) return;

    setSubmitting(true);
    try {
      await onCreate(form);
      onClose();
    } catch (err) {
      setError(
        err.message || "Couldn't create the doctor account. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h3>Create a doctor account</h3>
        <p className="modal-sub">
          The doctor is emailed a link to set their own password — no separate
          approval step once you submit this.
        </p>

        {error && (
          <div className="auth-alert">
            <IconAlert size={15} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="auth-field">
            <label htmlFor="doc-name">Full name</label>
            <input
              id="doc-name"
              value={form.name}
              onChange={update("name")}
              placeholder="Dr. Kwame Mensah"
            />
            {fieldErrors.name && (
              <div className="auth-field-error">{fieldErrors.name}</div>
            )}
          </div>

          <div className="auth-field">
            <label htmlFor="doc-email">Email</label>
            <input
              id="doc-email"
              type="email"
              value={form.email}
              onChange={update("email")}
              placeholder="doctor@example.com"
            />
            {fieldErrors.email && (
              <div className="auth-field-error">{fieldErrors.email}</div>
            )}
          </div>

          <div className="auth-field">
            <label htmlFor="doc-phone">Phone number</label>
            <input
              id="doc-phone"
              value={form.phone}
              onChange={update("phone")}
              placeholder="024 000 0000"
            />
            {fieldErrors.phone && (
              <div className="auth-field-error">{fieldErrors.phone}</div>
            )}
          </div>

          <div className="auth-field">
            <label htmlFor="doc-specialty">Specialty</label>
            <input
              id="doc-specialty"
              value={form.specialty}
              onChange={update("specialty")}
              placeholder="e.g. General Practice"
            />
            {fieldErrors.specialty && (
              <div className="auth-field-error">{fieldErrors.specialty}</div>
            )}
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-outline"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? "Creating…" : "Create account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Users({
  users,
  currentAdminId,
  onCreateDoctor,
  onDeactivate,
  onReactivate,
  onDelete,
}) {
  const [subtab, setSubtab] = useState("all");
  const [creatingDoctor, setCreatingDoctor] = useState(false);
  const [deactivating, setDeactivating] = useState(null);
  const [reactivating, setReactivating] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const patients = users.filter((u) => u.role === "patient");
  const doctors = users.filter((u) => u.role === "doctor");
  const admins = users.filter((u) => u.role === "admin");

  const rows =
    subtab === "all"
      ? users
      : subtab === "patients"
        ? patients
        : subtab === "doctors"
          ? doctors
          : admins;

  // The single source of truth for the permission rule described at the
  // top of this file: never the signed-in admin's own row, never another
  // admin's row.
  const isActionable = (u) => u.role !== "admin" && u.id !== currentAdminId;

  return (
    <>
      <section className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Users</h2>
            <p>
              Manage patient and doctor accounts. Doctor accounts can only be
              created here.
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setCreatingDoctor(true)}
          >
            <IconPlus size={14} /> Add doctor
          </button>
        </div>

        <div className="admin-subtabs">
          <button
            className={`admin-subtab${subtab === "all" ? " active" : ""}`}
            onClick={() => setSubtab("all")}
          >
            All ({users.length})
          </button>
          <button
            className={`admin-subtab${subtab === "patients" ? " active" : ""}`}
            onClick={() => setSubtab("patients")}
          >
            Patients ({patients.length})
          </button>
          <button
            className={`admin-subtab${subtab === "doctors" ? " active" : ""}`}
            onClick={() => setSubtab("doctors")}
          >
            Doctors ({doctors.length})
          </button>
          <button
            className={`admin-subtab${subtab === "admins" ? " active" : ""}`}
            onClick={() => setSubtab("admins")}
          >
            Admins ({admins.length})
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="admin-empty">No accounts here yet.</div>
        ) : (
          <div className="admin-panel-body">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td className="admin-cell-name">
                      {u.name}
                      {u.id === currentAdminId && (
                        <span className="admin-cell-sub"> (you)</span>
                      )}
                    </td>
                    <td>
                      <div>{u.email}</div>
                      <div className="admin-cell-sub">{u.phone}</div>
                    </td>
                    <td>{ROLE_LABELS[u.role] ?? u.role}</td>
                    <td>
                      <span className={`status-pill user-${u.status}`}>
                        {u.status === "active" ? "Active" : "Deactivated"}
                      </span>
                    </td>
                    <td>
                      {isActionable(u) ? (
                        <div className="admin-row-actions">
                          {u.status === "active" ? (
                            <button
                              className="btn btn-outline"
                              onClick={() => setDeactivating(u)}
                            >
                              <IconUserX size={14} /> Deactivate
                            </button>
                          ) : (
                            <button
                              className="btn btn-outline"
                              onClick={() => setReactivating(u)}
                            >
                              <IconUserCheck size={14} /> Reactivate
                            </button>
                          )}
                          <button
                            className="btn btn-outline danger"
                            onClick={() => setDeleting(u)}
                          >
                            <IconTrash size={14} /> Delete
                          </button>
                        </div>
                      ) : (
                        <span className="admin-cell-sub">
                          {u.role === "admin"
                            ? "Admin accounts are protected"
                            : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creatingDoctor && (
        <CreateDoctorModal
          onClose={() => setCreatingDoctor(false)}
          onCreate={onCreateDoctor}
        />
      )}

      {deactivating && (
        <ConfirmDialog
          title="Deactivate this account?"
          body={
            <>
              {deactivating.name} won't be able to sign in until reactivated.
              {deactivating.role === "doctor"
                ? " Reassign any of their upcoming scheduled consultations separately — this doesn't do that for you."
                : " Their existing bookings are unaffected."}
            </>
          }
          confirmLabel="Deactivate"
          tone="danger"
          onConfirm={() => {
            onDeactivate(deactivating);
            setDeactivating(null);
          }}
          onClose={() => setDeactivating(null)}
        />
      )}

      {reactivating && (
        <ConfirmDialog
          title="Reactivate this account?"
          body={
            <>{reactivating.name} will be able to sign in again immediately.</>
          }
          confirmLabel="Reactivate"
          onConfirm={() => {
            onReactivate(reactivating);
            setReactivating(null);
          }}
          onClose={() => setReactivating(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this account?"
          body={
            <>
              This permanently deletes {deleting.name}'s account and sign-in
              access. There are no backups, so it cannot be undone.
              {deleting.role === "doctor" &&
                " Make sure they have no upcoming scheduled consultations first."}
            </>
          }
          confirmLabel="Delete"
          tone="danger"
          onConfirm={() => {
            onDelete(deleting);
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
