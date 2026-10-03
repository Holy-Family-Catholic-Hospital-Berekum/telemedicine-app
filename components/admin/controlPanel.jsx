// controlPanel.jsx
//
// Admin "Control Panel" tab. Lets an administrator:
//   0. switch call recording on or off (RecordingSwitchCard)
//   1. change the photo on the home page hero
//   2. set the consultation prices
//   3. manage the photos in the BrandAside slideshow (add / remove / reorder)
//   4. change the photo on the sign-in and sign-up pages
//
// How saving works
//   Prices  -> callable `updateConsultationPrices` (admin-checked on the server)
//   Images  -> the browser uploads to Storage (rules: admins only), then calls
//              `updateSiteImages` with the storage paths. The server verifies
//              the files, writes siteSettings/public, deletes replaced files
//              and writes an auditLog entry. Nothing on this screen can write
//              settings directly, so hiding this tab is a convenience, not the
//              security boundary.
//
// Photos are resized in the browser before upload (long edge capped, saved as
// JPEG), so a 9 MB phone photo becomes a few hundred KB. That keeps the public
// pages quick on mobile data and keeps Storage usage negligible.

import { useEffect, useRef, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { ref as storageRef, uploadBytesResumable } from "firebase/storage";

import { functions, storage } from "../../src/firebase";
import {
  settingsRef,
  DEFAULT_IMAGES,
  DEFAULT_PRICES,
} from "../../src/siteSettings";
import ConfirmDialog from "./confirmDialog.jsx";
import "./controlPanel.css";
import LegalDocsCard from "./legalDocsCard.jsx";
import RecordingSwitchCard from "./recordingSwitchCard.jsx";

const callUpdatePrices = httpsCallable(functions, "updateConsultationPrices");
const callUpdateImages = httpsCallable(functions, "updateSiteImages");

const CURRENCY = "GHS";
const MAX_PRICE = 5000; // same limit as the server; catches 2500-for-250 typos
const MAX_SLIDES = 8;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_UPLOAD_MB = 15; // size of the file picked, before we shrink it
const MIN_LONG_EDGE = 600; // smaller than this looks soft on a wide screen

const PRICE_ROWS = [
  {
    key: "OPD",
    label: "General OPD",
    hint: "Everyday health concerns and check-ups",
  },
  {
    key: "SURGICAL",
    label: "Surgical consultation",
    hint: "Pre- and post-surgery consultations",
  },
];

const SLOT_LABEL = {
  hero: "Home page photo",
  auth: "Sign-in and sign-up photo",
  slider: "Side panel slideshow",
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function parsePrice(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PRICE) return null;
  return Math.round(n * 100) / 100;
}

function friendlyError(err, fallback) {
  const code = err?.code || "";
  if (
    code === "storage/unauthorized" ||
    code === "functions/permission-denied"
  ) {
    return "Your account isn't allowed to make this change.";
  }
  if (code === "functions/unauthenticated") {
    return "Your session has expired. Sign in again to continue.";
  }
  if (code === "storage/canceled") return "The upload was cancelled.";
  // Messages we wrote on the server are safe to show as they are.
  if (
    code.startsWith("functions/") &&
    code !== "functions/internal" &&
    err.message
  ) {
    return err.message;
  }
  return fallback;
}

/**
 * Validates and shrinks a picked photo. Always returns a JPEG so the server
 * and Storage rules only ever have one format to check. PNG transparency is
 * flattened onto white.
 */
async function prepareImage(file, maxDim) {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error("Use a JPG, PNG or WebP photo.");
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new Error(
      `That file is over ${MAX_UPLOAD_MB} MB. Choose a smaller photo.`,
    );
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("We couldn't read that photo. Try a different file.");
  }

  const longEdge = Math.max(bitmap.width, bitmap.height);
  if (longEdge < MIN_LONG_EDGE) {
    bitmap.close?.();
    throw new Error(
      `That photo is too small (${bitmap.width}×${bitmap.height}). Use one at least ${MIN_LONG_EDGE}px on its longest side.`,
    );
  }

  const scale = Math.min(1, maxDim / longEdge);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.86),
  );
  if (!blob)
    throw new Error("We couldn't process that photo. Try a different file.");
  return { blob, width, height };
}

/** Uploads to siteAssets/<folder>/… and resolves with the storage path. */
function uploadImage(blob, folder, onProgress) {
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
  const path = `siteAssets/${folder}/${name}`;
  const task = uploadBytesResumable(storageRef(storage, path), blob, {
    contentType: "image/jpeg",
    // File names are unique per upload, so browsers can cache them for good.
    cacheControl: "public,max-age=31536000,immutable",
  });
  return new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (s) => onProgress?.(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0),
      reject,
      () => resolve(path),
    );
  });
}

// Live copy of the settings document, including storage paths.
// undefined = still loading, null = nothing saved yet.
function useRawSettings() {
  const [raw, setRaw] = useState(undefined);
  const [error, setError] = useState(null);
  useEffect(
    () =>
      onSnapshot(
        settingsRef,
        (snap) => setRaw(snap.exists() ? snap.data() : null),
        (err) => setError(err),
      ),
    [],
  );
  return { raw, error };
}

function Notice({ note }) {
  if (!note) return null;
  return (
    <p
      role={note.tone === "error" ? "alert" : "status"}
      className={`cp-note cp-note-${note.tone}`}
    >
      {note.text}
    </p>
  );
}

function Progress({ value }) {
  return (
    <div
      className="cp-progress"
      role="progressbar"
      aria-label="Upload progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <span style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Prices                                                              */
/* ------------------------------------------------------------------ */

function PricesCard({ current, onAudit }) {
  // null until the admin types, so the fields follow the saved values.
  const [draft, setDraft] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const shown = draft ?? {
    OPD: String(current.OPD),
    SURGICAL: String(current.SURGICAL),
  };
  const parsed = {
    OPD: parsePrice(shown.OPD),
    SURGICAL: parsePrice(shown.SURGICAL),
  };
  const allValid = parsed.OPD !== null && parsed.SURGICAL !== null;
  const changed = PRICE_ROWS.filter(
    (r) => parsed[r.key] !== null && parsed[r.key] !== current[r.key],
  );
  const dirty = PRICE_ROWS.some((r) => shown[r.key] !== String(current[r.key]));
  const canReview = allValid && changed.length > 0 && !busy;

  const summary = changed
    .map(
      (r) =>
        `${r.label}: ${CURRENCY} ${current[r.key]} to ${CURRENCY} ${parsed[r.key]}`,
    )
    .join(". ");

  const onChange = (key) => (e) => {
    setNote(null);
    setDraft({ ...shown, [key]: e.target.value });
  };

  async function save() {
    setConfirming(false);
    setBusy(true);
    setNote(null);
    try {
      await callUpdatePrices({ OPD: parsed.OPD, SURGICAL: parsed.SURGICAL });
      // Keep showing what was saved until the live snapshot catches up.
      setDraft({ OPD: String(parsed.OPD), SURGICAL: String(parsed.SURGICAL) });
      setNote({
        tone: "ok",
        text: "Prices updated. New bookings use them now.",
      });
      onAudit?.("Changed consultation prices", summary);
    } catch (err) {
      setNote({
        tone: "error",
        text: friendlyError(
          err,
          "We couldn't update the prices. Check your connection and try again.",
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cp-card" aria-labelledby="cp-prices-title">
      <header className="cp-card-head">
        <h2 id="cp-prices-title">Consultation prices</h2>
        <p>
          The fee patients pay when they book. A booking that is already waiting
          for payment keeps the price it started with.
        </p>
      </header>

      <div className="cp-price-grid">
        {PRICE_ROWS.map((row) => {
          const invalid = draft !== null && parsed[row.key] === null;
          return (
            <div className="cp-field" key={row.key}>
              <label htmlFor={`cp-price-${row.key}`}>{row.label}</label>
              <div className={`cp-input${invalid ? " invalid" : ""}`}>
                <span aria-hidden="true">{CURRENCY}</span>
                <input
                  id={`cp-price-${row.key}`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={shown[row.key]}
                  onChange={onChange(row.key)}
                  aria-invalid={invalid}
                  aria-describedby={`cp-price-${row.key}-help`}
                  disabled={busy}
                />
              </div>
              <p
                id={`cp-price-${row.key}-help`}
                className={`cp-help${invalid ? " cp-help-error" : ""}`}
              >
                {invalid
                  ? `Enter an amount between 1 and ${MAX_PRICE}.`
                  : `${row.hint}. Currently ${CURRENCY} ${current[row.key]}.`}
              </p>
            </div>
          );
        })}
      </div>

      <Notice note={note} />

      <div className="cp-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canReview}
          onClick={() => setConfirming(true)}
        >
          {busy ? "Saving…" : "Review and save"}
        </button>
        {dirty && !busy && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setDraft(null);
              setNote(null);
            }}
          >
            Discard changes
          </button>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title="Update consultation prices?"
          body={`${summary}. New bookings will be charged the new price straight away.`}
          confirmLabel="Update prices"
          onConfirm={save}
          onClose={() => setConfirming(false)}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* One photo (home hero, sign-in / sign-up)                            */
/* ------------------------------------------------------------------ */

function SingleImageCard({
  slot,
  title,
  description,
  tips,
  aspect,
  maxDim,
  current, // { path, url } | null
  fallbackSrc,
  onAudit,
}) {
  const inputRef = useRef(null);
  const [picked, setPicked] = useState(null); // { blob, previewUrl, width, height }
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  // Free the preview's object URL whenever it is replaced or the card unmounts.
  useEffect(
    () => () => {
      if (picked) URL.revokeObjectURL(picked.previewUrl);
    },
    [picked],
  );

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets the same file be picked again
    if (!file) return;
    setNote(null);
    try {
      const prepared = await prepareImage(file, maxDim);
      setPicked({
        ...prepared,
        previewUrl: URL.createObjectURL(prepared.blob),
      });
    } catch (err) {
      setNote({ tone: "error", text: err.message });
    }
  }

  async function save() {
    if (!picked) return;
    setBusy(true);
    setNote(null);
    setProgress(0);
    try {
      const path = await uploadImage(picked.blob, slot, setProgress);
      await callUpdateImages({ [slot]: path });
      setPicked(null);
      setNote({
        tone: "ok",
        text: "Saved. The new photo is live on the site.",
      });
      onAudit?.("Changed site images", SLOT_LABEL[slot]);
    } catch (err) {
      setNote({
        tone: "error",
        text: friendlyError(
          err,
          "We couldn't save that photo. Check your connection and try again.",
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  async function restoreDefault() {
    setConfirmingReset(false);
    setBusy(true);
    setNote(null);
    try {
      await callUpdateImages({ [slot]: null });
      setNote({ tone: "ok", text: "Restored the built-in photo." });
      onAudit?.(
        "Changed site images",
        `${SLOT_LABEL[slot]} (restored default)`,
      );
    } catch (err) {
      setNote({
        tone: "error",
        text: friendlyError(
          err,
          "We couldn't restore the built-in photo. Try again.",
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  const src = picked?.previewUrl ?? current?.url ?? fallbackSrc;
  const status = picked ? "Not saved yet" : current ? "Live" : "Built-in photo";

  return (
    <section className="cp-card" aria-labelledby={`cp-${slot}-title`}>
      <header className="cp-card-head">
        <h2 id={`cp-${slot}-title`}>{title}</h2>
        <p>{description}</p>
      </header>

      <div className="cp-image-layout">
        <div className="cp-preview" style={{ aspectRatio: aspect }}>
          <img src={src} alt={`Preview of the ${title.toLowerCase()}`} />
          <span className={`cp-badge${picked ? " cp-badge-new" : ""}`}>
            {status}
          </span>
        </div>

        <div>
          <ul className="cp-tips">
            {tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            className="cp-file"
            onChange={onFile}
            tabIndex={-1}
            aria-hidden="true"
          />

          {busy && <Progress value={progress} />}
          <Notice note={note} />

          <div className="cp-actions">
            {picked ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={save}
                  disabled={busy}
                >
                  {busy ? "Saving…" : "Save photo"}
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setPicked(null)}
                  disabled={busy}
                >
                  Discard
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                >
                  Choose a new photo
                </button>
                {current && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setConfirmingReset(true)}
                    disabled={busy}
                  >
                    Restore built-in photo
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {confirmingReset && (
        <ConfirmDialog
          title="Restore the built-in photo?"
          body={`The photo you uploaded for the ${title.toLowerCase()} will be removed and the original one will be shown again.`}
          confirmLabel="Restore"
          onConfirm={restoreDefault}
          onClose={() => setConfirmingReset(false)}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* BrandAside slideshow                                                */
/* ------------------------------------------------------------------ */

function SliderCard({ current, onAudit }) {
  // null until the admin edits; then the working copy of the list.
  // Item: { key, path?, url, blob? } — `blob` marks a photo not yet uploaded.
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const inputRef = useRef(null);
  const seq = useRef(0);
  const uploaded = useRef({}); // key -> path, so a retry never uploads twice
  const itemsRef = useRef(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(
    () => () => {
      (itemsRef.current || []).forEach(
        (i) => i.blob && URL.revokeObjectURL(i.url),
      );
    },
    [],
  );

  const saved = current.map((i) => ({ key: i.path, path: i.path, url: i.url }));
  const list = items ?? saved;
  const usingDefaults = items === null && saved.length === 0;
  const dirty =
    items !== null &&
    (items.some((i) => i.blob) ||
      items.map((i) => i.key).join("|") !== saved.map((i) => i.key).join("|"));

  const revoke = (item) => item.blob && URL.revokeObjectURL(item.url);

  async function addFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;

    const room = MAX_SLIDES - list.length;
    if (room <= 0) {
      setNote({
        tone: "error",
        text: `The slideshow holds up to ${MAX_SLIDES} photos. Remove one to add another.`,
      });
      return;
    }
    setNote(null);

    const added = [];
    const problems = [];
    for (const file of files.slice(0, room)) {
      try {
        const { blob } = await prepareImage(file, 1400);
        added.push({
          key: `new-${seq.current++}`,
          blob,
          url: URL.createObjectURL(blob),
        });
      } catch (err) {
        problems.push(`${file.name}: ${err.message}`);
      }
    }
    if (files.length > room) {
      problems.push(
        `Only the first ${room} were added. The limit is ${MAX_SLIDES} photos.`,
      );
    }
    if (added.length) setItems((prev) => [...(prev ?? saved), ...added]);
    if (problems.length) setNote({ tone: "error", text: problems.join(" ") });
  }

  function remove(key) {
    setNote(null);
    setItems((prev) => {
      const base = prev ?? saved;
      const gone = base.find((i) => i.key === key);
      if (gone) revoke(gone);
      return base.filter((i) => i.key !== key);
    });
  }

  function move(index, delta) {
    setItems((prev) => {
      const base = [...(prev ?? saved)];
      const target = index + delta;
      if (target < 0 || target >= base.length) return base;
      [base[index], base[target]] = [base[target], base[index]];
      return base;
    });
  }

  function discard() {
    (items || []).forEach(revoke);
    uploaded.current = {};
    setItems(null);
    setNote(null);
  }

  async function save() {
    setBusy(true);
    setNote(null);
    setProgress(0);
    try {
      const pending = list.filter(
        (i) => !i.path && !uploaded.current[i.key],
      ).length;
      let done = 0;
      const paths = [];
      for (const item of list) {
        let path = item.path ?? uploaded.current[item.key];
        if (!path) {
          path = await uploadImage(item.blob, "slider", (f) =>
            setProgress((done + f) / pending),
          );
          uploaded.current[item.key] = path;
          done += 1;
        }
        paths.push(path);
      }
      await callUpdateImages({ slider: paths });
      list.forEach(revoke);
      uploaded.current = {};
      setItems(null);
      setNote({
        tone: "ok",
        text: "Saved. The slideshow is live on the site.",
      });
      onAudit?.("Changed site images", SLOT_LABEL.slider);
    } catch (err) {
      setNote({
        tone: "error",
        text: friendlyError(
          err,
          "We couldn't save the slideshow. Check your connection and try again.",
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  async function restoreDefaults() {
    setConfirmingReset(false);
    setBusy(true);
    setNote(null);
    try {
      await callUpdateImages({ slider: null });
      discard();
      setNote({ tone: "ok", text: "Restored the built-in photos." });
      onAudit?.(
        "Changed site images",
        `${SLOT_LABEL.slider} (restored default)`,
      );
    } catch (err) {
      setNote({
        tone: "error",
        text: friendlyError(
          err,
          "We couldn't restore the built-in photos. Try again.",
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cp-card" aria-labelledby="cp-slider-title">
      <header className="cp-card-head">
        <h2 id="cp-slider-title">Side panel slideshow</h2>
        <p>
          The photos that fade in and out beside the booking page. They play in
          the order shown here, first photo first. Tall photos work best; the
          edges are cropped to fit.
        </p>
      </header>

      {usingDefaults ? (
        <>
          <ul className="cp-thumbs">
            {DEFAULT_IMAGES.slider.map((src, i) => (
              <li className="cp-thumb" key={src + i}>
                <div className="cp-thumb-frame">
                  <img src={src} alt={`Built-in photo ${i + 1}`} />
                  <span className="cp-badge">Built-in</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="cp-help">
            These are the built-in photos. When you save your own, they replace
            this set.
          </p>
        </>
      ) : (
        <ul className="cp-thumbs">
          {list.map((item, i) => (
            <li className="cp-thumb" key={item.key}>
              <div className="cp-thumb-frame">
                <img src={item.url} alt={`Slideshow photo ${i + 1}`} />
                <span className={`cp-badge${item.blob ? " cp-badge-new" : ""}`}>
                  {item.blob ? "New" : i + 1}
                </span>
              </div>
              <div className="cp-thumb-bar">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={busy || i === 0}
                  aria-label={`Move photo ${i + 1} earlier`}
                  title="Move earlier"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => remove(item.key)}
                  disabled={busy}
                  aria-label={`Remove photo ${i + 1}`}
                  className="cp-thumb-remove"
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={busy || i === list.length - 1}
                  aria-label={`Move photo ${i + 1} later`}
                  title="Move later"
                >
                  →
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {items !== null && items.length === 0 && (
        <p className="cp-help">
          The slideshow is empty. Add at least one photo to save, or restore the
          built-in photos.
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        multiple
        className="cp-file"
        onChange={addFiles}
        tabIndex={-1}
        aria-hidden="true"
      />

      {busy && <Progress value={progress} />}
      <Notice note={note} />

      <div className="cp-actions">
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => inputRef.current?.click()}
          disabled={busy || list.length >= MAX_SLIDES}
        >
          Add photos
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={busy || !dirty || list.length === 0}
        >
          {busy ? "Saving…" : "Save slideshow"}
        </button>
        {dirty && !busy && (
          <button type="button" className="btn btn-outline" onClick={discard}>
            Discard changes
          </button>
        )}
        {!dirty && saved.length > 0 && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setConfirmingReset(true)}
            disabled={busy}
          >
            Restore built-in photos
          </button>
        )}
      </div>
      <p className="cp-help">
        {list.length} of {MAX_SLIDES} photos
        {usingDefaults ? " (built-in set)" : ""}.
      </p>

      {confirmingReset && (
        <ConfirmDialog
          title="Restore the built-in photos?"
          body="Your uploaded slideshow photos will be removed and the original set will be shown again."
          confirmLabel="Restore"
          onConfirm={restoreDefaults}
          onClose={() => setConfirmingReset(false)}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Tab                                                                 */
/* ------------------------------------------------------------------ */

/**
 * `onAudit(action, targetId)` is optional. admin.jsx passes pushAudit so the
 * mock audit tab shows these changes. The real entries are written by the
 * Cloud Functions; once AuditPanel reads from Firestore, stop passing it or
 * every change will appear twice.
 */
export default function ControlPanel({ onAudit }) {
  const { raw, error } = useRawSettings();

  if (error) {
    return (
      <div className="cp-stack">
        <Notice
          note={{
            tone: "error",
            text: "We couldn't load the current settings, so changes are switched off. Refresh the page, or check that the Firestore rules for siteSettings are deployed.",
          }}
        />
      </div>
    );
  }
  if (raw === undefined) {
    return (
      <div className="cp-stack">
        <p className="cp-loading" role="status">
          Loading current settings…
        </p>
      </div>
    );
  }

  const prices = {
    OPD: raw?.prices?.OPD ?? DEFAULT_PRICES.OPD,
    SURGICAL: raw?.prices?.SURGICAL ?? DEFAULT_PRICES.SURGICAL,
  };

  return (
    <div className="cp-stack">
      <RecordingSwitchCard />

      <SingleImageCard
        slot="hero"
        title="Home page photo"
        description="The large photo beside the headline at the top of the home page."
        tips={[
          "Warm, real photos of a doctor with a patient work best.",
          "Keep the people in the middle or right of the frame. The left edge fades into white and phones crop the sides.",
          "Landscape or square, at least 1200px wide.",
        ]}
        aspect="1 / 1"
        maxDim={1800}
        current={raw?.heroImage ?? null}
        fallbackSrc={DEFAULT_IMAGES.hero}
        onAudit={onAudit}
      />

      <PricesCard current={prices} onAudit={onAudit} />

      <SliderCard current={raw?.sliderImages ?? []} onAudit={onAudit} />

      <SingleImageCard
        slot="auth"
        title="Sign-in and sign-up photo"
        description="The photo behind the panel on the left of the sign-in and sign-up pages. Both pages use the same one."
        tips={[
          "Tall photos work best; the panel is narrow and full height.",
          "A wash of the brand colours is laid over it, so avoid very dark photos.",
        ]}
        aspect="3 / 4"
        maxDim={1400}
        current={raw?.authImage ?? null}
        fallbackSrc={DEFAULT_IMAGES.auth}
        onAudit={onAudit}
      />
      <LegalDocsCard onAudit={onAudit} />
    </div>
  );
}
