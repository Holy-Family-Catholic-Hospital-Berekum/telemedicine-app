// src/doctorDirectory.js
//
// List of doctors shown on the home page and in the booking picker, read
// from the public `doctorProfiles` collection (isListed == true).
// Admins control listing and consultation types; each doctor edits their
// own photo and specialties from the doctor portal. Bio, languages,
// qualifications and years of experience are not shown anywhere (Ghana's
// rules on advertising doctors).
//
// Loading, so the "Meet our doctors" section is never empty for long:
//   - the list (public information only) is kept on the device from the
//     last visit, so a returning visitor sees the doctors at once;
//   - reading starts as soon as this file loads (with the page), not when
//     the section first draws, and is shared by every component using it;
//   - a failed read is retried after 2, 5 and 10 seconds before giving up;
//   - not live (lighter on mobile data): read again when the visitor comes
//     back to the page after a minute or more.
//
// Shape returned for each doctor:
//   { id, name, role, availableFor, specialties, image,
//     initials, isAvailable, availability }

import { useSyncExternalStore } from "react";

const REFRESH_AFTER_MS = 60 * 1000;
const RETRY_AFTER_MS = [2000, 5000, 10000];
const CACHE_KEY = "hfh:doctors:v1";

function initialsOf(name) {
  return String(name || "")
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function toDoctor(id, data) {
  const isAvailable = data.isAvailable !== false;
  return {
    id,
    name: data.name || "Doctor",
    role: data.roleTitle || "",
    availableFor: Array.isArray(data.availableFor) ? data.availableFor : [],
    specialties: Array.isArray(data.specialties) ? data.specialties : [],
    // Only our own Storage URLs (rules enforce this on write as well).
    image:
      typeof data.photoURL === "string" &&
      data.photoURL.startsWith("https://firebasestorage.googleapis.com/")
        ? data.photoURL
        : null,
    initials: initialsOf(data.name),
    isAvailable,
    availability: data.availabilityNote || (isAvailable ? "Available" : "Not on duty"),
  };
}

async function fetchListedDoctors() {
  const [{ db }, { collection, getDocs, query, where }] = await Promise.all([
    import("./firebase"),
    import("firebase/firestore"),
  ]);
  const snap = await getDocs(query(collection(db, "doctorProfiles"), where("isListed", "==", true)));
  return snap.docs.map((d) => toDoctor(d.id, d.data())).sort((a, b) => a.name.localeCompare(b.name));
}

/* ---- one shared list, however many components use it ---- */

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}
function writeCache(doctors) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(doctors));
  } catch {
    // storage blocked (private mode): the list just isn't kept
  }
}

const cached = typeof window !== "undefined" ? readCache() : null;
// loading: no list to show yet (first visit, still reading).
let state = { doctors: cached || [], loading: !cached, error: null };
const listeners = new Set();
let lastLoaded = 0;
let inFlight = null;

function publish(next) {
  state = next;
  listeners.forEach((l) => l());
}

function load(attempt = 0) {
  if (inFlight && attempt === 0) return inFlight; // already reading
  lastLoaded = Date.now();
  inFlight = fetchListedDoctors().then(
    (doctors) => {
      inFlight = null;
      writeCache(doctors);
      publish({ doctors, loading: false, error: null });
    },
    (error) => {
      if (attempt < RETRY_AFTER_MS.length) {
        // Keep inFlight set: a visit to the page meanwhile doesn't start
        // a second read; the retry replaces it.
        setTimeout(() => load(attempt + 1), RETRY_AFTER_MS[attempt]);
        return;
      }
      inFlight = null;
      // Keep whatever is on screen (a kept list) and stop "loading".
      publish({ ...state, loading: false, error });
    },
  );
  return inFlight;
}

if (typeof window !== "undefined") {
  // Start with the page, not when the section first draws.
  load();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastLoaded > REFRESH_AFTER_MS) load();
  });
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const getSnapshot = () => state;

/** { doctors, loading, error } — doctors sorted by name. */
export function useListedDoctors() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
