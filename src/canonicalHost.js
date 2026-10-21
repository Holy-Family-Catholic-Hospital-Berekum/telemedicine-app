// canonicalHost.js
//
// Firebase Hosting also serves the site at the project's own addresses
// (telemedicine-hfch.web.app, telemedicine-hfch.firebaseapp.com), which
// can't be switched off. With VITE_CANONICAL_REDIRECT=on (the live build,
// once the hospital's domain points at Firebase), a visit to one of those
// is sent to the real address (VITE_SITE_URL), so patients only ever sign
// in, pay and install the app on one site. Firebase's own pages under
// /__/ (password reset links, sign-in helpers) don't run this code.
// Imported first in index.jsx, before anything else runs.

const target = import.meta.env.VITE_CANONICAL_REDIRECT === "on" ? import.meta.env.VITE_SITE_URL : "";

if (target) {
  try {
    const site = new URL(target);
    const host = window.location.hostname;
    const firebaseDefault = host.endsWith(".web.app") || host.endsWith(".firebaseapp.com");
    if (firebaseDefault && host !== site.hostname && site.protocol === "https:") {
      // Only the path, query and fragment carry over, each set on a URL
      // that already has our origin, so nothing in the address bar can
      // change where this goes (e.g. a path like "//elsewhere.com").
      const dest = new URL(site.origin);
      dest.pathname = window.location.pathname;
      dest.search = window.location.search;
      dest.hash = window.location.hash;
      if (dest.origin === site.origin) window.location.replace(dest.href);
    }
  } catch {
    // A malformed VITE_SITE_URL: stay put rather than break the page.
  }
}
