import { Link } from "react-router-dom";
import { BOOKING_CONSENT_TEXT, GUARDIAN_CONSENT_TEXT } from "../../../src/consentText";

// Data consent: the versioned wording; the server records which version
// was agreed to (see src/consentText.js).
export default function ConsentFields({
  consent,
  setConsent,
  forChild,
  guardianConsent,
  setGuardianConsent,
}) {
  return (
    <fieldset className="mt-8 rounded-2xl border border-black/10 p-5">
      <legend className="text-[16px] font-medium mb-2 px-1">
        Your information
      </legend>
      {/* Versioned wording: the server records which version
          was agreed to (see src/consentText.js). */}
      <p className="text-[16px] text-black/90">
        {BOOKING_CONSENT_TEXT}
      </p>
      <label className="mt-4 flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 rounded border-black/30 text-[#F88535] focus:ring-[#F88535]"
        />
        <span className="text-[16px] text-black/80">
          I agree to Holy Family Catholic Hospital collecting and
          using my information as described above to provide this
          consultation. Read our {" "}
          <Link
            to="/privacy"
            rel="noopener noreferrer"
            target="_blank"
            className="underline text-[#0095D9] hover:text-[#0077ad]"
          >
            privacy policy
          </Link>
          {" "}
          and
          {" "}
          <Link
            to="/terms"
            rel="noopener noreferrer"
            target="_blank"
            className="underline text-[#0095D9] hover:text-[#0077ad]"
          >
            terms of service
          </Link>
          .
        </span>
      </label>
      {forChild && (
        <label className="mt-4 flex items-start gap-3 cursor-pointer border-t border-black/10 pt-4">
          <input
            type="checkbox"
            checked={guardianConsent}
            onChange={(e) => setGuardianConsent(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 rounded border-black/30 text-[#F88535] focus:ring-[#F88535]"
          />
          <span className="text-[16px] text-black/85">
            {GUARDIAN_CONSENT_TEXT}
          </span>
        </label>
      )}
    </fieldset>
  );
}
