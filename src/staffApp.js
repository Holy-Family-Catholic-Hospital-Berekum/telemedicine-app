// src/staffApp.js
//
// On the staff pages (staff sign-in, admin, doctor), the browser is offered
// the STAFF app ("Holy Family Staff", vite.config.js staffAppManifest):
// installed on a desktop, it opens straight on the staff sign-in page. The
// patient pages keep the patient app ("Holy Family", opens the dashboard).

import { useEffect } from "react";

export function useStaffAppManifest() {
  useEffect(() => {
    const href = import.meta.env.VITE_STAFF_MANIFEST;
    const link = document.querySelector('link[rel="manifest"]');
    if (!href || !link) return undefined;
    const previous = link.getAttribute("href");
    link.setAttribute("href", href);
    return () => {
      if (previous) link.setAttribute("href", previous);
    };
  }, []);
}
