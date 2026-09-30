import LegalPage from "../legalPage.jsx";

/**
 * terms.jsx
 * Public terms of service, lives at "/terms".
 *
 * The text is edited by admins in Control panel > Terms and privacy policy.
 * Built-in fallback text lives in src/legalDefaults.js.
 */
export default function Terms() {
  return (
    <LegalPage
      docId="terms"
      heading="Terms of service"
      contactLead="For questions about these terms, email"
    />
  );
}
