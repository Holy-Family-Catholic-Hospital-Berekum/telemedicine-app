import react from "@vitejs/plugin-react";
import process from "node:process";
import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";

// The public address of the site, used for canonical links, social-share
// previews, robots.txt and sitemap.xml. Set VITE_SITE_URL (Vercel env and
// .env) when the hospital's own domain goes live; until then the Vercel
// address is used.
const DEFAULT_SITE_URL = "https://telemedicine-hfch.vercel.app";

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

function seoFiles(siteUrl) {
  return {
    name: "seo-files",
    // %SITE_URL% in index.html (canonical, Open Graph, structured data).
    transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", siteUrl),
    generateBundle() {
      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: [
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

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const siteUrl = (env.VITE_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
  return {
    plugins: [react(), tailwindcss(), seoFiles(siteUrl)],
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
