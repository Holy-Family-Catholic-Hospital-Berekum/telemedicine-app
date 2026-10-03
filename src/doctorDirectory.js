// src/doctorDirectory.js
//
// Live list of doctors shown on the home page and in the booking picker,
// read from the public `doctorProfiles` collection (isListed == true).
// Admins control listing and consultation types; each doctor edits their
// own photo, bio, specialties and languages from the doctor portal.
//
// Shape returned for each doctor:
//   { id, name, role, title, yearsExperience, availableFor, specialties,
//     languages, focus, bio, image, initials, isAvailable, availability }

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "./firebase";

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
    languages: Array.isArray(data.languages) ? data.languages : [],
    focus: data.focus || "",
    bio: data.bio || "",
    title: typeof data.title === "string" ? data.title : "",
    yearsExperience: Number(data.yearsExperience) || 0,
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

/** { doctors, loading, error } — doctors sorted by name. */
export function useListedDoctors() {
  const [state, setState] = useState({ doctors: [], loading: true, error: null });

  useEffect(() => {
    const q = query(collection(db, "doctorProfiles"), where("isListed", "==", true));
    return onSnapshot(
      q,
      (snap) => {
        const doctors = snap.docs
          .map((d) => toDoctor(d.id, d.data()))
          .sort((a, b) => a.name.localeCompare(b.name));
        setState({ doctors, loading: false, error: null });
      },
      (error) => setState({ doctors: [], loading: false, error }),
    );
  }, []);

  return state;
}
