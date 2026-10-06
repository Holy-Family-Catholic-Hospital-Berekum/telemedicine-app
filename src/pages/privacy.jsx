import LegalPage from "../legalPage.jsx";
import { usePageMeta } from "../seo.js";

/**
 * privacy.jsx
 * Public privacy policy, lives at "/privacy". The booking page links here
 * from its consent checkbox (opens in a new tab), so the wording must mirror
 * what that checkbox promises.
 *
 * The text is edited by admins in Control panel > Terms and privacy policy.
 * Built-in fallback text lives in src/legalDefaults.js.
 */
export default function Privacy() {
  usePageMeta({
    title: "Privacy Policy",
    description:
      "How Holy Family Catholic Hospital's telemedicine service collects, uses, protects and deletes your personal information, under Ghana's Data Protection Act, 2012 (Act 843).",
    path: "/privacy",
  });
  return (
    <LegalPage
      docId="privacy"
      heading="Privacy policy"
      contactLead="To use any of your rights, or to ask a question about this policy, email"
    />
  );
}
