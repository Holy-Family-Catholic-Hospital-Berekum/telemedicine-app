// seo.js
//
// usePageMeta: each page's title, description, canonical URL and indexing
// rule. Google renders the app, so these runtime tags are what it indexes
// for every route; index.html holds the home-page defaults (also used by
// link previews, which don't run JavaScript).
//
//   usePageMeta({ title, description, path: "/terms" })   public page
//   usePageMeta({ title, noindex: true })                  private page
//
// Private pages (dashboard, booking, admin, doctor, staff sign-in) are
// noindex: they show nothing useful to a signed-out crawler, and the staff
// path must never appear in search results.

import { useEffect } from "react";

const SITE_NAME = "Holy Family Catholic Hospital";
const DEFAULT_DESCRIPTION =
  "See a Holy Family Catholic Hospital, Berekum doctor by video or in person. Book General OPD or surgical consultations online and pay with mobile money.";

/** The canonical origin: the one in index.html (set at build time). */
function siteOrigin() {
  const href = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
  try {
    return href ? new URL(href).origin : window.location.origin;
  } catch {
    return window.location.origin;
  }
}

function setMeta(selector, attr, value) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement("meta");
    const [, key, name] = selector.match(/\[(name|property)="([^"]+)"\]/) || [];
    if (key) el.setAttribute(key, name);
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

export function usePageMeta({ title, description = DEFAULT_DESCRIPTION, path, noindex = false }) {
  useEffect(() => {
    const fullTitle = title ? `${title} | ${SITE_NAME}` : document.title;
    document.title = fullTitle;
    setMeta('meta[name="description"]', "content", description);
    setMeta('meta[name="robots"]', "content", noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large");
    setMeta('meta[property="og:title"]', "content", fullTitle);
    setMeta('meta[property="og:description"]', "content", description);
    if (path && !noindex) {
      const url = `${siteOrigin()}${path}`;
      document.head.querySelector('link[rel="canonical"]')?.setAttribute("href", url);
      setMeta('meta[property="og:url"]', "content", url);
    }
  }, [title, description, path, noindex]);
}
