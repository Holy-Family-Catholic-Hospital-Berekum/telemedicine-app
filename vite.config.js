import react from "@vitejs/plugin-react";
import process from "node:process";
import { createHash } from "node:crypto";
import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// The public address of the site, used for canonical links, social-share
// previews, robots.txt and sitemap.xml. Set VITE_SITE_URL (GitHub environment and
// .env); defaults to the hospital's own domain.
const DEFAULT_SITE_URL = "https://telemedicine.hfhberekum.org";

// Public pages search engines should list. Private pages (dashboard,
// booking, admin, doctor) are disallowed in robots.txt and marked noindex;
// the staff sign-in path is never listed anywhere.
const PUBLIC_PAGES = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/signup", priority: "0.6", changefreq: "monthly" },
  { path: "/signin", priority: "0.4", changefreq: "monthly" },
  { path: "/privacy", priority: "0.3", changefreq: "yearly" },
  { path: "/terms", priority: "0.3", changefreq: "yearly" },
];

function seoFiles(siteUrl, hideFromSearch) {
  return {
    name: "seo-files",
    // %SITE_URL% in index.html (canonical, Open Graph, structured data).
    // The test website (VITE_SEARCH_INDEXING=off) is noindex everywhere.
    transformIndexHtml: (html) => {
      const out = html.replaceAll("%SITE_URL%", siteUrl);
      return hideFromSearch
        ? out.replace(/<meta name="robots" content="[^"]*"/, '<meta name="robots" content="noindex, nofollow"')
        : out;
    },
    generateBundle() {
      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: hideFromSearch ? "User-agent: *\nDisallow: /\n" : [
          "User-agent: *",
          "Allow: /",
          "Disallow: /dashboard",
          "Disallow: /book",
          "Disallow: /admin",
          "Disallow: /doctor",
          "Disallow: /verify-email",
          "Disallow: /unauthorized",
          "",
          `Sitemap: ${siteUrl}/sitemap.xml`,
          "",
        ].join("\n"),
      });
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...PUBLIC_PAGES.map(
            (p) =>
              `  <url><loc>${siteUrl}${p.path === "/" ? "/" : p.path}</loc><lastmod>${today}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`,
          ),
          "</urlset>",
          "",
        ].join("\n"),
      });
    },
  };
}

// Installable app + offline shell (service worker, Workbox). Built for weak
// connections: the patient pages' code, styles, logo and Latin fonts are
// stored up front, so the installed app always opens; staff portals and
// photos are stored the first time they're used. Firestore and the Cloud
// Functions are never cached (privacy: nothing about appointments is kept
// on the device). A new version waits until the user taps "Refresh"
// (components/shared/appUpdate.jsx), so an update never cuts a video call.
const pwa = VitePWA({
  registerType: "prompt",
  injectRegister: false,
  manifest: {
    // short_name is the label under the home-screen icon (about 12
    // characters fit); name is used on the install prompt and splash.
    id: "/dashboard",
    name: "Holy Family Telemedicine",
    short_name: "Holy Family",
    description: "Book and join video consultations with Holy Family Catholic Hospital, Berekum.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#0095D9",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
  workbox: {
    // Every page a patient can reach, so the installed app opens offline
    // (sign-in, dashboard, booking, terms…). Staff portals (admin, doctor,
    // staff sign-in) and file uploads are left out: staff work online.
    globPatterns: [
      "index.html",
      "assets/*.{js,css}",
      "assets/logo-*.webp",
      "assets/*-latin-wght-normal-*.woff2",
      "favicon-32.png",
      "apple-touch-icon.png",
    ],
    globIgnores: [
      "assets/firebase-storage-*",
      "assets/admin-*",
      "assets/doctor-*",
      "assets/staffSignIn-*",
    ],
    // Every route is the app (React Router); the shell works offline.
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [/^\/robots\.txt$/, /^\/sitemap\.xml$/, /^\/__\//],
    cleanupOutdatedCaches: true,
    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
    runtimeCaching: [
      {
        // Hashed build files never change: keep them once used.
        urlPattern: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/assets/"),
        handler: "CacheFirst",
        options: {
          cacheName: "app-assets",
          expiration: { maxEntries: 120, maxAgeSeconds: 60 * 24 * 3600 },
        },
      },
    ],
  },
});

// A second installable app for staff ("Holy Family Staff"): it opens on
// the staff sign-in page instead of the patient dashboard. Its manifest is
// written at build time under a name derived from the staff path (not
// guessable without it), and only the staff pages point to it
// (src/staffApp.js), so the patient app and the public pages are unchanged.
// A different manifest `id` lets both apps be installed on one computer.
function staffAppManifest(rawPath) {
  const trimmed = (rawPath || "").trim();
  const staffPath = trimmed ? (trimmed.startsWith("/") ? trimmed : `/${trimmed}`) : null;
  const file = staffPath
    ? `staff-${createHash("sha256").update(staffPath).digest("hex").slice(0, 16)}.webmanifest`
    : null;
  return {
    name: "staff-app-manifest",
    config: () => ({
      define: { "import.meta.env.VITE_STAFF_MANIFEST": JSON.stringify(file ? `/${file}` : "") },
    }),
    generateBundle() {
      if (!file) return;
      this.emitFile({
        type: "asset",
        fileName: file,
        source: JSON.stringify(
          {
            id: "/holy-family-staff",
            name: "Holy Family Staff",
            short_name: "HF Staff",
            description: "Sign-in for Holy Family telemedicine staff (administrators and doctors).",
            start_url: staffPath,
            scope: "/",
            display: "standalone",
            background_color: "#ffffff",
            theme_color: "#12242C",
            icons: [
              { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
              { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
              { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
            ],
          },
          null,
          2,
        ),
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const siteUrl = (env.VITE_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
  return {
    plugins: [react(), tailwindcss(), seoFiles(siteUrl, env.VITE_SEARCH_INDEXING === "off"),staffAppManifest(env.VITE_STAFF_LOGIN_PATH), pwa],
    // Which release a browser error came from (src/errorReporting.js):
    // the commit GitHub Actions builds, or "local".
    define: {
      "import.meta.env.VITE_BUILD_ID": JSON.stringify(
        (process.env.GITHUB_SHA || "local").slice(0, 7),
      ),
    },
    build: {
      rollupOptions: {
        output: {
          // Firebase and React change rarely: separate files stay cached
          // across app releases.
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            // Storage only loads with the pages that upload files.
            if (id.includes("@firebase/storage") || id.includes("firebase/storage")) return "firebase-storage";
            if (id.includes("firebase")) return "firebase";
            if (id.includes("react")) return "react";
            return undefined;
          },
        },
      },
    },
  };
});
