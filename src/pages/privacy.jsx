import LegalPage from "../legalPage.jsx";

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
  return (
    <LegalPage
      docId="privacy"
      heading="Privacy policy"
      contactLead="To use any of your rights, or to ask a question about this policy, email"
    />
  );
}
