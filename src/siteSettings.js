/**
 * src/siteSettings.js
 *
 * The one place the public site reads admin-controlled settings from:
 * consultation prices and the four kinds of editable image. The Control
 * Panel (admin) writes them through Cloud Functions; everything else on the
 * site just calls useSiteSettings().
 *
 * Firestore document:  siteSettings/public
 *   prices        { OPD: number, SURGICAL: number }
 *   heroImage     { path, url } | null     home page photo
 *   authImage     { path, url } | null     sign-in / sign-up photo
 *   sliderImages  [{ path, url }]          BrandAside slideshow, in order
 *
 * Anything missing falls back to the bundled defaults below, so the site
 * looks right before an admin has changed anything, and if Firestore can't
 * be reached.
 *
 * Why the `ready` flag: without it, a visitor would first see the bundled
 * photo and then watch it swap for the admin's photo. Components render the
 * image only once `ready` is true. `ready` flips as soon as we have either a
 * cached copy from the last visit, the live document, or (worst case) after
 * a 2.5 s timeout, so a slow connection never leaves a blank hero.
 *
 * ASSUMPTIONS — adjust if your project differs:
 *   - this file lives at src/siteSettings.js next to src/firebase.js
 *   - the image imports below match where BrandAside/Home import them from
 *   - React 18+ (useSyncExternalStore)
 */

import { useSyncExternalStore } from "react";
import { doc, getFirestore, onSnapshot } from "firebase/firestore";
import { app } from "./firebase";

import heroDefault from "./assets/hero-consult.jpg";
import authDefault from "./assets/auth-bg.jpg";
import slide1 from "../images/sidebarImages/sidebarImage1.jpg";
import slide2 from "../images/sidebarImages/sidebarImage2.jpg";
import slide3 from "../images/sidebarImages/sidebarImage3.jpg";
import slide4 from "../images/sidebarImages/sidebarImage4.jpg";

/** Bundled images used until an admin uploads their own. */
export const DEFAULT_IMAGES = {
  hero: heroDefault,
  auth: authDefault,
  slider: [authDefault, slide1, slide2, slide3, slide4],
};

/**
 * Fallback fees, used only until an admin sets prices. Keep in step with
 * DEFAULT_FEES in functions/siteSettings.js. The server is what actually
 * charges; this is display only.
 */
// By mode: video call or hospital visit (General OPD and Surgical cost
// the same).
export const DEFAULT_PRICES = { online: 150, in_person: 150 };

// The hospital's services ("Our services" on the home page). Admins edit
// the list in the Control panel; this is shown until Firestore answers.
export const DEFAULT_SERVICES = [
  "General Surgery",
  "Obstetrics & Gynaecology",
  "Child Health",
  "Dental & Maxillofacial Surgery",
  "Ear, Nose & Throat (ENT)",
  "Internal Medicine",
  "Cardiology",
  "Plastic Surgery",
  "Orthopaedic Surgery",
  "Family Medicine",
];

/**
 * No-show policy, until an admin sets it (Control panel). Keep in step with
 * DEFAULT_NO_SHOW in functions/siteSettings.js; the server enforces it.
 *   waitMinutes     how long whoever is in the video room first waits for
 *                   the other (from the start, or from when they joined if
 *                   later); functions/lib/consultationLifecycle.js
 *   forfeitPercent  share of the fee kept when a no-show asks for a refund
 *   rescheduleFee   GHS a no-show pays to book a new time
 */
export const DEFAULT_NO_SHOW = { waitMinutes: 5, forfeitPercent: 20, rescheduleFee: 50 };
const inRange = (n, min, max) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;

export const settingsRef = doc(getFirestore(app), "siteSettings", "public");

const CACHE_KEY = "hfh.siteSettings.v1";
const READY_TIMEOUT_MS = 2500;

const goodPrice = (n) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);
const goodUrl = (img) =>
  img && typeof img.url === "string" && img.url.startsWith("https://") ? img.url : null;

/** Raw Firestore data (or null) -> the shape the site uses. */
export function normaliseSettings(data) {
  const d = data || {};
  return {
    prices: {
      online: goodPrice(d.prices?.online) ?? DEFAULT_PRICES.online,
      in_person: goodPrice(d.prices?.in_person) ?? DEFAULT_PRICES.in_person,
    },
    heroImage: goodUrl(d.heroImage),
    authImage: goodUrl(d.authImage),
    sliderImages: Array.isArray(d.sliderImages)
      ? d.sliderImages.map(goodUrl).filter(Boolean)
      : [],
    // Admin switch; missing = allowed. The server enforces it too.
    doctorSelectionEnabled: d.doctorSelectionEnabled !== false,
    // Admin switch; missing = pay online. Off: hospital visits are free to
    // book and paid at the hospital. The server enforces it too.
    inPersonPaymentRequired: d.inPersonPaymentRequired !== false,
    services: Array.isArray(d.services)
      ? d.services.filter((s) => typeof s === "string" && s.trim()).slice(0, 40)
      : DEFAULT_SERVICES,
    noShow: {
      waitMinutes: inRange(d.noShow?.waitMinutes, 1, 30) ? d.noShow.waitMinutes : DEFAULT_NO_SHOW.waitMinutes,
      forfeitPercent: inRange(d.noShow?.forfeitPercent, 0, 100) ? d.noShow.forfeitPercent : DEFAULT_NO_SHOW.forfeitPercent,
      rescheduleFee: inRange(d.noShow?.rescheduleFee, 0, 5000) ? d.noShow.rescheduleFee : DEFAULT_NO_SHOW.rescheduleFee,
    },
  };
}

// Tiny cache so a returning visitor's first paint already has the right
// photos. Stores only what normaliseSettings needs (no timestamps).
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? normaliseSettings(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
function writeCache(data) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        prices: data?.prices ?? null,
        heroImage: data?.heroImage ? { url: data.heroImage.url } : null,
        authImage: data?.authImage ? { url: data.authImage.url } : null,
        sliderImages: (data?.sliderImages || []).map((i) => ({ url: i.url })),
        doctorSelectionEnabled: data?.doctorSelectionEnabled !== false,
        inPersonPaymentRequired: data?.inPersonPaymentRequired !== false,
        services: Array.isArray(data?.services) ? data.services : null,
        noShow: data?.noShow ?? null,
      }),
    );
  } catch {
    /* private mode / storage full — the cache is optional */
  }
}

/* ---- one shared listener, however many components use the hook ---- */

const cached = readCache();
let state = { settings: cached ?? normaliseSettings(null), ready: cached !== null };
const listeners = new Set();
let unsubscribe = null;
let readyTimer = null;

function publish(next) {
  state = next;
  listeners.forEach((l) => l());
}

function start() {
  if (unsubscribe) return;
  unsubscribe = onSnapshot(
    settingsRef,
    (snap) => {
      const data = snap.exists() ? snap.data() : null;
      writeCache(data);
      publish({ settings: normaliseSettings(data), ready: true });
    },
    () => publish({ ...state, ready: true }), // offline or denied: show defaults
  );
  if (!state.ready) {
    readyTimer = setTimeout(() => {
      if (!state.ready) publish({ ...state, ready: true });
    }, READY_TIMEOUT_MS);
  }
}

function subscribe(listener) {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
      clearTimeout(readyTimer);
    }
  };
}

const getSnapshot = () => state;

/**
 * @returns {{ ready: boolean, settings: {
 *   prices: { online: number, in_person: number },
 *   heroImage: string|null, authImage: string|null, sliderImages: string[],
 *   doctorSelectionEnabled: boolean, inPersonPaymentRequired: boolean,
 *   noShow: { waitMinutes, forfeitPercent, rescheduleFee }
 * }}}
 */
export function useSiteSettings() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
