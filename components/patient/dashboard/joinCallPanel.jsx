import { useState } from "react";
import { Video, Lock, Loader2, ShieldQuestion, PhoneCall } from "lucide-react";
import { getCallWindow } from "./patientUtils";
import { joinVideoCall } from "./patientFirestoreService";
import { callableMessage } from "../../../src/constants";

// Mirrors the architecture's join flow (Section 7): "the patient logs in,
// enters the consultation ID, and joins the video room." Typing the ID is
// deliberate friction, not a missing shortcut — it's the check that ties
// the phone call from admin to this specific session (4.5, 9).
export default function JoinCallPanel({ booking, onJoined }) {
  const [enteredId, setEnteredId] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);
  const { unlocked, minutesUntilUnlock } = getCallWindow(booking.scheduledTime);
  const callInProgress = Boolean(booking.callStartedAt);

  async function handleJoin(e) {
    e.preventDefault();
    setJoining(true);
    setError(null);
    try {
      const result = await joinVideoCall({
        booking,
        enteredConsultationId: enteredId,
      });
      onJoined(booking.bookingId, result);
    } catch (err) {
      setError(callableMessage(err, "We couldn't open the video room."));
    } finally {
      setJoining(false);
    }
  }

  if (!unlocked && !callInProgress) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-sm border border-[#DCE6EC] px-3.5 py-2.5 text-sm text-[#5C6B72]">
        <Lock size={14} strokeWidth={1.75} />
        The video room opens {minutesUntilUnlock}m before your appointment
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
          You're connected to the video room
        </span>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleJoin}
      className="mt-4 rounded-md border border-[#DCE6EC] p-3.5"
    >
      <p className="flex items-center gap-1.5 text-xs text-[#5C6B72]">
        <ShieldQuestion size={13} strokeWidth={1.75} />
        Enter the consultation ID the hospital gave you to join
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          type="text"
          value={enteredId}
          onChange={(e) => {
            setEnteredId(e.target.value);
            setError(null);
          }}
          placeholder="e.g. HFC-XXXXXXXXXX"
          className="min-w-0 flex-1 rounded-sm border border-[#DCE6EC] px-3 py-2 text-sm font-mono uppercase text-[#12242C] focus:border-[#0095D9] focus:outline-none"
        />
        <button
          type="submit"
          disabled={joining || !enteredId.trim()}
          className="flex items-center gap-2 rounded-sm px-3.5 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: "#0095D9" }}
        >
          {joining ? (
            <Loader2 size={15} strokeWidth={2} className="animate-spin" />
          ) : (
            <Video size={15} strokeWidth={2} />
          )}
          {joining ? "Checking…" : "Join call"}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-[#5C6B72]">
        Calls may be recorded (video with sound, or sound only) when the
        hospital has recording switched on. You'll see a REC sign on screen if this call
        is recorded.
      </p>
      {error && (
        <p className="mt-2 text-xs text-[#B23A3A]">
          {error} Check the message from the hospital.
        </p>
      )}
    </form>
  );
}
