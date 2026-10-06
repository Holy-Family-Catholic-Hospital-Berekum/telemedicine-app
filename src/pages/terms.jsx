import LegalPage from "../legalPage.jsx";
import { usePageMeta } from "../seo.js";

/**
 * terms.jsx
 * Public terms of service, lives at "/terms".
 *
 * The text is edited by admins in Control panel > Terms and privacy policy.
 * Built-in fallback text lives in src/legalDefaults.js.
 */
export default function Terms() {
  usePageMeta({
    title: "Terms of Service",
    description:
      "The terms for booking and attending online and in-person consultations with Holy Family Catholic Hospital, Berekum: fees, rescheduling, refunds and your responsibilities.",
    path: "/terms",
  });
  return (
    <LegalPage
      docId="terms"
      heading="Terms of service"
      contactLead="For questions about these terms, email"
    />
  );
}
