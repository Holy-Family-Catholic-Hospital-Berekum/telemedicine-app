// users.jsx
//
// Admin-only user management.
//
// PERMISSION RULE (UI side, enforced in isActionable below):
//   Admin can deactivate or reactivate any patient or doctor account,
//   never their own and never another admin's. setAccountStatus enforces
//   the same rule on the server, which is the real gate.
//
// Accounts are deactivated, never deleted: deactivation disables sign-in
// and revokes sessions at once, and keeps history and recordings
// resolving to a real person. Admin accounts are created only with the
// hospital's staffAdmin script, never from the app.
//
// Doctors are created by createDoctorAccount (server). The doctor then
// receives Firebase's password-reset email to set their own password, and
// the admin is shown a one-time SETUP CODE to hand over in person: the
// doctor needs it once, to link their authenticator app at first sign-in.
// "Authenticator" on a doctor's row issues a new code (first setup) or
// resets a lost authenticator (staffAuth.js resetStaffAuthenticator).

import { useMemo, useState } from "react";
import ConfirmDialog from "./confirmDialog.jsx";
import {
  IconPlus,
  IconUserX,
  IconUserCheck,
  IconAlert,
  IconX,
} from "./icons.jsx";
import {
  isValidEmail,
  isValidPhone,
  isValidName,
} from "../../src/utils/validators.js";
import { callableMessage } from "../../src/constants";
import { Pagination, LoadOlder } from "../shared/pagination.jsx";
import { usePagination } from "../shared/usePagination.js";

const ROLE_LABELS = {
  patient: "Patient",
  doctor: "Doctor",
  admin: "Admin",
};

// Inline so this file doesn't depend on bookingsPanel.jsx's local
// components — move into a shared file if you'd rather not duplicate it
// a third time when the next panel needs a search box.
function IconSearch({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M17 17l-3.8-3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SearchInput({ value, onChange, placeholder }) {
  return (
    <div
      className="admin-search"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        border: "1px solid var(--admin-border, #DCE6EC)",
        borderRadius: 8,
        padding: "6px 10px",
        maxWidth: 320,
        marginBottom: 14,
      }}
    >
      <IconSearch />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ border: "none", outline: "none", flex: 1, fontSize: 13.5 }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          style={{ display: "flex", color: "inherit" }}
        >
          <IconX size={13} />
        </button>
      )}
    </div>
  );
}

// Was rendering with `modal-overlay` / `modal-card`, classes that belong
// to the auth pages (signIn/signUp) and aren't defined in admin.css — so
// nothing here actually painted as an overlay. Switched to the
// `admin-modal-backdrop` / `admin-modal` pattern used by SchedulingModal
// and ConfirmDialog elsewhere in this dashboard, plus click-outside-to-
// close for consistency with those.
function CreateDoctorModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    specialty: "",
    availableFor: ["OPD"],
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
    if (form.availableFor.length === 0)
      errs.availableFor = "Choose at least one consultation type.";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!validate()) return;

    setSubmitting(true);
    try {
      await onCreate({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        department: form.specialty.trim(),
        availableFor: form.availableFor,
      });
      onClose();
    } catch (err) {
      setError(
        callableMessage(err, "Couldn't create the doctor account. Please try again."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="admin-modal-backdrop"
      onClick={() => !submitting && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Create a doctor account</h3>
        <p className="sub">
          The doctor is emailed a link to set their own password. You'll then
          see a one-time setup code to give them in person, for linking their
          authenticator app.
        </p>

        {error && (
          <div className="auth-alert">
            <IconAlert size={15} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="admin-field">
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

          <div className="admin-field">
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

          <div className="admin-field">
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

          <div className="admin-field">
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

          <div className="admin-field">
            <span>Takes consultations</span>
            {[
              ["OPD", "General OPD"],
              ["SURGICAL", "Surgical"],
            ].map(([value, label]) => (
              <label key={value} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={form.availableFor.includes(value)}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      availableFor: e.target.checked
                        ? [...f.availableFor, value]
                        : f.availableFor.filter((t) => t !== value),
                    }))
                  }
                />
                {label}
              </label>
            ))}
            {fieldErrors.availableFor && (
              <div className="auth-field-error">{fieldErrors.availableFor}</div>
            )}
          </div>

          <div className="admin-modal-actions">
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

/** Shows a one-time setup code once; it isn't stored anywhere readable. */
function SetupCodeDialog({ shown, onClose }) {
  return (
    <div className="admin-modal-backdrop" role="dialog" aria-modal="true">
      <div className="admin-modal">
        <h3>Setup code for {shown.name}</h3>
        <p className="sub">
          Give this code to {shown.name} in person or by phone, never by
          email or message. They enter it once, at their first sign-in, to
          link their authenticator app. It expires in 72 hours. It won't be
          shown again.
        </p>
        <p
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textAlign: "center",
            margin: "18px 0",
            userSelect: "all",
          }}
        >
          {shown.code}
        </p>
        <ol className="sub" style={{ paddingLeft: 20, lineHeight: 1.6 }}>
          <li>They sign in on the staff page with their email and password.</li>
          <li>They scan the QR code with Google or Microsoft Authenticator.</li>
          <li>They sign in again with the app's code, then enter this setup code.</li>
        </ol>
        <div className="admin-modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            I've noted it down
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Users({
  users,
  patientsWindow,
  currentAdminId,
  onCreateDoctor,
  onDoctorAuthenticator,
  onDeactivate,
  onReactivate,
}) {
  const [subtab, setSubtab] = useState("all");
  const [creatingDoctor, setCreatingDoctor] = useState(false);
  const [shownCode, setShownCode] = useState(null); // { name, code }
  const [authFor, setAuthFor] = useState(null); // doctor whose authenticator to reset/issue
  const [deactivating, setDeactivating] = useState(null);
  const [reactivating, setReactivating] = useState(null);

  // One query per subtab, same reasoning as BookingsPanel: switching
  // between "Doctors" and "Patients" to compare something shouldn't lose
  // what you typed in the other tab.
  const [queries, setQueries] = useState({
    all: "",
    patients: "",
    doctors: "",
    admins: "",
  });
  const query = queries[subtab];
  const setQuery = (value) => setQueries((prev) => ({ ...prev, [subtab]: value }));

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

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((u) => {
      const haystack = [u.name, u.email, u.phone, ROLE_LABELS[u.role], u.specialty]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, query]);

  const pager = usePagination(filteredRows, 25, `${subtab}|${query}`);

  const SEARCH_PLACEHOLDER = {
    all: "Search by name, email, or phone…",
    patients: "Search patients by name, email, or phone…",
    doctors: "Search doctors by name, email, or specialty…",
    admins: "Search admins by name or email…",
  };

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

        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={SEARCH_PLACEHOLDER[subtab]}
        />

        {rows.length === 0 ? (
          <div className="admin-empty">No accounts here yet.</div>
        ) : filteredRows.length === 0 ? (
          <div className="admin-empty">No accounts match "{query}".</div>
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
                {pager.pageItems.map((u) => (
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
                          {u.role === "doctor" && u.status === "active" && (
                            <button
                              className="btn btn-outline"
                              onClick={() => setAuthFor(u)}
                              title={u.mfaFactorUid ? "Authenticator linked" : "No authenticator linked yet"}
                            >
                              {u.mfaFactorUid ? "Reset authenticator" : "Setup code"}
                            </button>
                          )}
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
            <Pagination {...pager} noun="accounts" />
          </div>
        )}
        {patientsWindow && (subtab === "all" || subtab === "patients") && (
          <LoadOlder {...patientsWindow} onLoadMore={patientsWindow.loadMore} noun="patients" />
        )}
      </section>

      {creatingDoctor && (
        <CreateDoctorModal
          onClose={() => setCreatingDoctor(false)}
          onCreate={async (form) => {
            const result = await onCreateDoctor(form);
            if (result?.setupCode) setShownCode({ name: form.name, code: result.setupCode });
            return result;
          }}
        />
      )}

      {authFor && (
        <ConfirmDialog
          title={
            authFor.mfaFactorUid
              ? `Reset ${authFor.name}'s authenticator?`
              : `Issue a setup code for ${authFor.name}?`
          }
          body={
            authFor.mfaFactorUid
              ? "Only do this if they lost or replaced their phone, and you've confirmed it's really them (in person or on a number you already have). Their current authenticator stops working, they're signed out everywhere, and you'll get a new setup code to give them."
              : "You'll get a one-time code to give them in person, so they can link their authenticator app. Any earlier code stops working."
          }
          confirmLabel={authFor.mfaFactorUid ? "Reset and show code" : "Show setup code"}
          tone={authFor.mfaFactorUid ? "danger" : undefined}
          onConfirm={async () => {
            const target = authFor;
            setAuthFor(null);
            try {
              const result = await onDoctorAuthenticator(target, Boolean(target.mfaFactorUid));
              if (result?.setupCode) setShownCode({ name: target.name, code: result.setupCode });
            } catch {
              // the admin shell shows the error banner
            }
          }}
          onClose={() => setAuthFor(null)}
        />
      )}

      {shownCode && <SetupCodeDialog shown={shownCode} onClose={() => setShownCode(null)} />}

      {deactivating && (
        <ConfirmDialog
          title="Deactivate this account?"
          body={
            <>
              {deactivating.name} is signed out everywhere and can't sign in
              until reactivated.
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

    </>
  );
}