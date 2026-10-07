import { useEffect, useState } from "react";
import { Video, Lock, Loader2, PhoneCall, Timer } from "lucide-react";
import { getCallWindow } from "./patientUtils";
import { joinVideoCall } from "./patientFirestoreService";
import { callableMessage, CALL_UNLOCK_MINUTES } from "../../../src/constants";
import { CURRENT_CALL_CONSENT } from "../../../src/consentText";
import CallConsentDialog from "./callConsentDialog";
import { useSiteSettings } from "../../../src/siteSettings";

function formatWait(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// One click to join: the server checks this is the patient booked on the
// consultation and that the video room is open. The first join of each
// consultation also asks for the video consultation consent (stored by the
// server); later joins don't.
//
// The no-show rule is stated here too: the patient has the policy's
// waiting time to join after the start (or after the doctor joined, if
// later); then the server marks a no-show automatically. Once the doctor
// is in the room, a countdown shows the time left.
export default function JoinCallPanel({ booking, onJoined }) {
  const { noShow } = useSiteSettings().settings;
  const [now, setNow] = useState(() => Date.now());
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);
  const [askConsent, setAskConsent] = useState(false);
  const { unlocked, minutesUntilUnlock } = getCallWindow(booking.scheduledTime);
  // The patient has been in this call before: "Rejoin call" takes them back.
  const callInProgress = Boolean(booking.patientJoinedAt);
  const doctorWaiting = Boolean(booking.doctorJoinedAt) && !callInProgress;
  const deadline = doctorWaiting
    ? Math.max(booking.scheduledTime?.getTime?.() ?? 0, booking.doctorJoinedAt.getTime()) +
      noShow.waitMinutes * 60000
    : null;
  const left = deadline === null ? null : Math.max(0, deadline - now);

  useEffect(() => {
    if (deadline === null) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const rule = `Please join on time. If you haven't joined within ${noShow.waitMinutes} minutes of the start (or of your doctor joining, if later), the consultation is marked as missed.${noShow.rescheduleFee > 0 ? ` Booking a new time after that costs an extra GHS ${noShow.rescheduleFee}.` : ""}`;

  async function join(withConsent) {
    setJoining(true);
    setError(null);
    try {
      const result = await joinVideoCall({
        booking,
        callConsentVersion: withConsent ? CURRENT_CALL_CONSENT : undefined,
      });
      setAskConsent(false);
      onJoined(booking.bookingId, result);
    } catch (err) {
      if (err?.details?.reason === "call_consent_required") {
        setAskConsent(true);
      } else {
        setAskConsent(false);
        setError(callableMessage(err, "We couldn't start the video call. Try again."));
      }
    } finally {
      setJoining(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    // First join of this consultation: consent first.
    if (!booking.callConsentId) setAskConsent(true);
    else join(false);
  }

  if (!unlocked && !callInProgress) {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-sm border border-[#DCE6EC] px-3.5 py-2.5 text-sm text-[#3E4E56]">
        <Lock size={14} strokeWidth={1.75} className="mt-1 shrink-0" />
        <span>
          You can join the call from {CALL_UNLOCK_MINUTES} minutes before your
          appointment (in {formatWait(minutesUntilUnlock)}). {rule}
        </span>
      </div>
    );
  }

  if (callInProgress) {
    return (
      <div
        className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-sm px-3.5 py-2.5 text-sm"
        style={{ backgroundColor: "#0095D91A", color: "#0B6BA0" }}
      >
        <span className="flex items-center gap-2">
          <PhoneCall size={15} strokeWidth={2} />
          Your call has started. Tap "Rejoin call" to go back in.
        </span>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="mt-4 rounded-md border border-[#DCE6EC] p-3.5">
        {doctorWaiting && (
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-[#1E8E5A]">
            <PhoneCall size={14} strokeWidth={2} />
            Your doctor is waiting for you. Tap Join call now.
          </p>
        )}
        {left !== null && (
          <p
            role="timer"
            className="mb-2 flex items-center gap-1.5 rounded-sm bg-[#B23A3A]/10 px-3 py-2 text-sm font-semibold text-[#B23A3A]"
          >
            <Timer size={15} strokeWidth={2} />
            {left > 0
              ? `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")} left to join before this is marked as missed`
              : "Your joining time is up. Join now, or refresh the page to see your options."}
          </p>
        )}
        <p className="text-sm text-[#12242C]">
          You can join the call now. Find a quiet, private place.
        </p>
        <button
          type="submit"
          disabled={joining}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          style={{ backgroundColor: "#1E8E5A" }}
        >
          {joining ? (
            <Loader2 size={16} strokeWidth={2} className="animate-spin" />
          ) : (
            <Video size={16} strokeWidth={2} />
          )}
          {joining ? "Joining…" : "Join call"}
        </button>
        <p className="mt-2 text-[14px] text-[#3E4E56]">{rule}</p>
        <p className="mt-2 text-[14px] text-[#3E4E56]">
          Calls may be recorded (video with sound, or sound only) when the
          hospital has recording switched on. You'll see a REC sign on screen
          if this call is recorded.
        </p>
        {error && <p className="mt-2 text-xs text-[#B23A3A]">{error}</p>}
      </form>

      {askConsent && (
        <CallConsentDialog
          busy={joining}
          onAgree={() => join(true)}
          onCancel={() => setAskConsent(false)}
        />
      )}
    </>
  );
}
