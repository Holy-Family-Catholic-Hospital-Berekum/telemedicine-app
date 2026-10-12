// src/doctorDirectory.js
//
// List of doctors shown on the home page and in the booking picker, read
// from the public `doctorProfiles` collection (isListed == true). Read once
// (not live: lighter on mobile data), and again when the visitor comes back
// to the page after a minute or more. Firebase is loaded on demand, so the
// page shows first.
// Admins control listing and consultation types; each doctor edits their
// own photo and specialties from the doctor portal. Bio, languages,
// qualifications and years of experience are not shown anywhere (Ghana's
// rules on advertising doctors).
//
// Shape returned for each doctor:
//   { id, name, role, availableFor, specialties, image,
//     initials, isAvailable, availability }

import { useEffect, useState } from "react";

const REFRESH_AFTER_MS = 60 * 1000;

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

/** { doctors, loading, error } — doctors sorted by name. */
export function useListedDoctors() {
  const [state, setState] = useState({ doctors: [], loading: true, error: null });

  useEffect(() => {
    let active = true;
    let lastLoaded = 0;
    const load = () => {
      lastLoaded = Date.now();
      fetchListedDoctors()
        .then((doctors) => active && setState({ doctors, loading: false, error: null }))
        .catch((error) => active && setState((s) => ({ ...s, loading: false, error })));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoaded > REFRESH_AFTER_MS) load();
    };
    load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return state;
}
