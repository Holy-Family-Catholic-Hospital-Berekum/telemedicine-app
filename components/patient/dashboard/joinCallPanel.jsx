import { useEffect, useState } from "react";
import { Video, Lock, Loader2, PhoneCall, Timer } from "lucide-react";
import { getCallWindow } from "./patientUtils";
import { joinVideoCall } from "./patientFirestoreService";
import { callableMessage, CALL_UNLOCK_MINUTES, formatTime } from "../../../src/constants";
import { CURRENT_CALL_CONSENT } from "../../../src/consentText";
import CallConsentDialog from "./callConsentDialog";
import DeviceCheck from "./deviceCheck";
import { useSiteSettings } from "../../../src/siteSettings";

function formatWait(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// One click to join: a camera/microphone check first, then the server
// checks this is the patient booked on the consultation and that the video
// room is open. The first join of each consultation also asks for the
// video consultation consent (stored by the server); later joins don't.
//
// The waiting rule is stated here too (functions/lib/consultationLifecycle.js):
// whoever is in the room first waits up to the policy's waiting time for
// the other, counted from the start or from when they joined, if later.
// booking.waitDeadline shows whose turn it is: the patient's (the doctor is
// in the room: countdown) or the doctor's.
export default function JoinCallPanel({ booking, onJoined }) {
  const { noShow } = useSiteSettings().settings;
  const [now, setNow] = useState(() => Date.now());
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [askConsent, setAskConsent] = useState(false);
  const { unlocked, minutesUntilUnlock } = getCallWindow(booking.scheduledTime);
  // The two were connected: the consultation is under way.
  const met = Boolean(booking.metAt);
  const deadline = !met ? booking.waitDeadline : null;
  const myTurn = deadline?.for === "patient";
  const left = deadline ? Math.max(0, deadline.at.getTime() - now) : null;

  useEffect(() => {
    if (!deadline) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const rule = `Please join on time. Whoever is in the video room first waits up to ${noShow.waitMinutes} minutes for the other (from the start time, or from when they joined if later). If your doctor is waiting and you don't join in that time, the consultation is marked as missed${noShow.rescheduleFee > 0 ? ` and booking a new time costs an extra GHS ${noShow.rescheduleFee}` : ""}. If your doctor doesn't join in time, you get a new time at no cost or a full refund.`;

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

  // After the camera/microphone check: consent first on the first join.
  function afterCheck() {
    setChecking(false);
    if (!booking.callConsentId) setAskConsent(true);
    else join(false);
  }

  function handleSubmit(e) {
    e.preventDefault();
    setChecking(true);
  }

  if (!unlocked && !booking.patientJoinedAt) {
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

  return (
    <>
      <form onSubmit={handleSubmit} className="mt-4 rounded-md border border-[#DCE6EC] p-3.5">
        {met && (
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-[#0B6BA0]">
            <PhoneCall size={14} strokeWidth={2} />
            Your consultation has started. Tap Join call to go back in.
          </p>
        )}
        {myTurn && (
          <p
            role="timer"
            className="mb-2 flex items-start gap-1.5 rounded-sm bg-[#B23A3A]/10 px-3 py-2 text-sm font-semibold text-[#B23A3A]"
          >
            <Timer size={15} strokeWidth={2} className="mt-0.5 shrink-0" />
            {left > 0
              ? `Your doctor is in the call. Join before ${formatTime(deadline.at)} (${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")} left), or this is marked as missed.`
              : "Your joining time is up. Refresh the page to see your options."}
          </p>
        )}
        {deadline?.for === "doctor" && (
          <p className="mb-2 flex items-start gap-1.5 text-sm text-[#3E4E56]">
            <Timer size={15} strokeWidth={2} className="mt-0.5 shrink-0" />
            Your doctor has until {formatTime(deadline.at)} to join. You can wait in the call.
          </p>
        )}
        {!met && (
          <p className="text-sm text-[#12242C]">
            You can join the call now. Find a quiet, private place.
          </p>
        )}
        <button
          type="submit"
          disabled={joining || checking}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          style={{ backgroundColor: "#1E8E5A" }}
        >
          {joining ? (
            <Loader2 size={16} strokeWidth={2} className="animate-spin" />
          ) : (
            <Video size={16} strokeWidth={2} />
          )}
          {joining ? "Joining…" : booking.patientJoinedAt ? "Join call again" : "Join call"}
        </button>
        {!met && <p className="mt-2 text-[14px] text-[#3E4E56]">{rule}</p>}
        <p className="mt-2 text-[14px] text-[#3E4E56]">
          Calls may be recorded (video with sound, or sound only) when the
          hospital has recording switched on. You'll see a REC sign on screen
          if this call is recorded. You may not record the call or take
          screenshots yourself.
        </p>
        {error && <p className="mt-2 text-xs text-[#B23A3A]">{error}</p>}
      </form>

      {checking && <DeviceCheck onReady={afterCheck} onCancel={() => setChecking(false)} />}

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
