import { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  ShieldCheck,
  Circle,
  Loader2,
  ShieldAlert,
  Timer,
  CalendarX2,
  EyeOff,
} from "lucide-react";
import { useWebRTCCall } from "./useWebRTCCall";
import hospitalLogo from "../../src/assets/logo.webp";
import { functions } from "../../src/firebase";
import { useAuth } from "../../src/context/authContext.jsx";

const callReportCapture = httpsCallable(functions, "reportCaptureAttempt");
const callHeartbeat = httpsCallable(functions, "callHeartbeat");

// The call screen checks in this often: the server records who is in the
// room, notices when the two are connected, runs the shared countdown and
// says when the call is over (functions/consultations.js callHeartbeat).
const HEARTBEAT_MS = 15_000;

// Screen capture. A web page can't stop the operating system, another app
// or a second phone from capturing the screen (hospital decision: browser
// deterrence only), so:
// - a notice when the call opens (patients) that recording and screenshots
//   aren't allowed, are logged, and show their name;
// - the other person's video carries a watermark with the viewer's name
//   and the date and time, which drifts around so it can't be cropped out;
// - for patients, the video is hidden while the call window isn't in front
//   (another app, a screen recorder, another tab);
// - screenshot / screen-recording shortcuts the browser can see (Print
//   Screen; Cmd+Shift+3/4/5 on Mac; Win+Shift+S / Win+Alt+R are usually
//   taken by Windows first) show a warning and are logged to the audit tab
//   (reportCaptureAttempt);
// - right-click (save video), picture-in-picture and dragging are off.
// The hospital's own recording (callRecording.js) is unaffected.
function captureMethod(e) {
  const key = String(e.key || "");
  if (key === "PrintScreen" || e.code === "PrintScreen") return "print_screen";
  if (e.metaKey && e.shiftKey && ["3", "4"].includes(key))
    return "screenshot_shortcut";
  if (e.metaKey && e.shiftKey && key === "5") return "record_shortcut";
  if (e.metaKey && e.shiftKey && key.toLowerCase() === "s")
    return "screenshot_shortcut";
  if (e.metaKey && e.altKey && key.toLowerCase() === "r")
    return "record_shortcut";
  return null;
}

function Watermark({ text }) {
  // Tiled and diagonal, and it drifts every few seconds so no part of the
  // picture stays clear of it: readable in a capture, not in the way.
  const [shift, setShift] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const id = setInterval(
      () =>
        setShift({
          x: Math.round(Math.random() * 120 - 60),
          y: Math.round(Math.random() * 80 - 40),
        }),
      5000,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 select-none overflow-hidden"
    >
      <div
        className="absolute -inset-1/2 flex rotate-[-24deg] flex-wrap content-center gap-x-24 gap-y-20 opacity-[0.22] transition-transform duration-[2000ms] ease-in-out"
        style={{
          transform: `translate(${shift.x}px, ${shift.y}px) rotate(-24deg)`,
        }}
      >
        {Array.from({ length: 40 }, (_, i) => (
          <span
            key={i}
            className="whitespace-nowrap text-sm font-semibold text-white lg:text-lg"
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * VideoCallModal — full-screen call view, laid out for a phone, a laptop or
 * a TV in the consulting room.
 *
 * - The other person's video is shown WHOLE (letterboxed, never cropped),
 *   so a portrait phone camera fits a landscape TV and vice versa.
 * - Header and controls are fixed bars; the video area takes what's left,
 *   so the controls are always on screen.
 * - Own camera is a mirrored picture-in-picture, larger on big screens.
 *
 * Props: consultationId, role ("doctor" | "patient"),
 *        patientSeq (patient only, from startVideoCall), viewerName
 *        (for the anti-capture watermark), waitDeadline ({ for, at } from
 *        startVideoCall: the shared countdown both sides see), onClose
 */
/** The call can't go on: say why, then close (and free the camera). */
function CallOverPanel({ role, room, onClose }) {
  const incomplete = room.kind === "call_incomplete";
  const content =
    room.state === "doctor_unavailable"
      ? role === "patient"
        ? {
            title: incomplete
              ? "Your consultation couldn't be completed"
              : "Your doctor couldn't make it",
            body: incomplete
              ? "We're sorry. We'll email you a new time to finish your consultation, at no cost. If you prefer, you can ask for a full refund from your dashboard."
              : "We're sorry. We'll email you a new time at no extra cost. If you prefer, you can ask for a full refund from your dashboard.",
          }
        : {
            title: "Passed to the hospital to reschedule",
            body: "The patient has been told and will get a new time or a full refund.",
          }
      : room.state === "no_show"
        ? role === "patient"
          ? {
              title: "You didn't join in time",
              body: "This consultation was marked as missed. Open your dashboard to book a new time or ask for a refund.",
            }
          : {
              title: "The patient didn't join in time",
              body: "The consultation has been marked as a no-show. You can close the call.",
            }
        : {
            title: "This consultation has ended",
            body: "You can close the call.",
          };
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 text-[#12242C] shadow-xl">
        <p className="flex items-center gap-2 text-base font-semibold">
          <CalendarX2 size={20} className="text-[#A85420]" />
          {content.title}
        </p>
        <p className="mt-2 text-sm text-[#3E4E56]">{content.body}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-md bg-[#0095D9] px-4 py-2.5 text-sm font-semibold text-white"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export default function VideoCallModal({
  consultationId,
  role,
  patientSeq,
  viewerName,
  waitDeadline: initialDeadline = null,
  onClose,
}) {
  const {
    localVideoRef,
    remoteVideoRef,
    status,
    errorMessage,
    micOn,
    cameraOn,
    isRecording,
    recordingMode,
    recordingWarning,
    toggleMic,
    toggleCamera,
    hangUp,
  } = useWebRTCCall({ consultationId, role, patientSeq, onEnded: onClose });

  const { holdSession } = useAuth();
  const [now, setNow] = useState(() => new Date());

  // No idle sign-out while the call is on screen (people talk without
  // touching the mouse); the normal timer resumes when it closes.
  useEffect(() => holdSession(), [holdSession]);
  const [captureWarning, setCaptureWarning] = useState(false);
  // Patients: the recording notice when the call opens, and the video
  // hidden while the window isn't in front.
  const [noticeOpen, setNoticeOpen] = useState(role === "patient");
  const [away, setAway] = useState(false);

  // What the server says about the room (callHeartbeat).
  const [room, setRoom] = useState({
    state: "open",
    waitDeadline: initialDeadline,
    met: false,
  });
  const deadline =
    room.state === "open" && !room.met ? room.waitDeadline : null;
  const counting = Boolean(deadline) && status !== "connected";

  // Keeps the watermark's time current (and the countdown, each second,
  // while it runs).
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), counting ? 1000 : 30000);
    return () => clearInterval(id);
  }, [counting]);

  // Check in with the server every 15 s, straight away when the video
  // connects, and more often once a countdown has run out (so the outcome
  // shows quickly). Leaving tells the server too.
  const connectedRef = useRef(false);
  useEffect(() => {
    connectedRef.current = status === "connected";
  }, [status]);
  const overdue = counting && deadline.at <= now.getTime();
  useEffect(() => {
    if (!consultationId) return undefined;
    let stopped = false;
    const beat = () =>
      callHeartbeat({ consultationId, connected: connectedRef.current })
        .then(({ data }) => {
          if (!stopped && data?.state)
            setRoom((prev) => ({ ...prev, ...data }));
        })
        .catch(() => {});
    beat();
    const id = setInterval(beat, overdue ? 5000 : HEARTBEAT_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [consultationId, status === "connected", overdue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving (or closing the screen) frees the room at once.
  useEffect(
    () => () => {
      if (consultationId)
        callHeartbeat({ consultationId, leaving: true }).catch(() => {});
    },
    [consultationId],
  );

  // Patients: hide the video while the call isn't the window in front.
  useEffect(() => {
    if (role !== "patient") return undefined;
    const update = () =>
      setAway(document.visibilityState === "hidden" || !document.hasFocus());
    window.addEventListener("blur", update);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("blur", update);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [role]);

  useEffect(() => {
    if (!consultationId) return undefined;
    let hideTimer;
    const onKey = (e) => {
      const method = captureMethod(e);
      if (!method) return;
      setCaptureWarning(true);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setCaptureWarning(false), 8000);
      // Print Screen copies to the clipboard: overwrite it where allowed.
      navigator.clipboard?.writeText?.("").catch(() => {});
      callReportCapture({ consultationId, method }).catch(() => {});
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => {
      clearTimeout(hideTimer);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
    };
  }, [consultationId]);

  if (!consultationId) return null;

  const watermarkText = `${viewerName || (role === "doctor" ? "Doctor" : "Patient")} · ${now.toLocaleString(
    "en-GB",
    {
      timeZone: "Africa/Accra",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  )} · Confidential`;

  const other = role === "doctor" ? "patient" : "doctor";
  const otherLabel = role === "doctor" ? "The patient" : "Your doctor";
  const left = counting ? Math.max(0, deadline.at - now.getTime()) : null;
  const until = counting
    ? new Date(deadline.at).toLocaleTimeString("en-GB", {
        timeZone: "Africa/Accra",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "";
  // The same countdown on both screens: whoever is waiting sees how long
  // the other side has left.
  const countdown =
    left === null || deadline.for !== other
      ? null
      : left > 0
        ? {
            clock: `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`,
            text:
              role === "doctor"
                ? `The patient has until ${until} to join. After that, the consultation is marked as a no-show.`
                : `Your doctor has until ${until} to join. If they don't, you'll get a new time at no cost, or a full refund.`,
          }
        : {
            clock: "0:00",
            text:
              role === "doctor"
                ? "Time's up. Marking as a no-show…"
                : "Your doctor didn't join in time. One moment…",
          };
  const overlay =
    status === "connecting"
      ? "Connecting…"
      : status === "waiting"
        ? `Waiting for ${otherLabel === "The patient" ? "the patient" : "your doctor"} to join…`
        : status === "reconnecting"
          ? "Connection interrupted — reconnecting…"
          : status === "ending"
            ? role === "doctor" && isRecording
              ? "Saving the recording…"
              : "Ending call…"
            : null;

  return (
    <div
      className="fixed inset-0 z-50 flex h-[100dvh] select-none flex-col bg-black"
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 bg-[#F28539] px-4 py-2.5 lg:px-6 lg:py-3">
        <div className="flex min-w-0 items-center gap-2">
          <img
            src={hospitalLogo}
            alt="Holy Family Catholic Hospital"
            className="h-6 w-6 shrink-0 rounded-full object-contain lg:h-8 lg:w-8"
          />
          <span className="truncate text-xs font-medium text-white/90 sm:text-sm lg:text-base">
            Holy Family Catholic Hospital
          </span>
          {isRecording && (
            <span
              className="ml-1 flex shrink-0 items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[11px] font-medium text-white lg:text-sm"
              title={`This consultation is being recorded (${recordingMode === "audio" ? "audio only" : "video and audio"}). Only authorised hospital administrators can open recordings.`}
            >
              <Circle
                size={8}
                strokeWidth={0}
                fill="#E4483C"
                className="animate-pulse"
              />
              {recordingMode === "audio" ? "REC · audio" : "REC"}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 text-xs text-white/80 lg:text-sm">
          {/* Transport encryption (DTLS-SRTP) holds even through the TURN
              relay. Not claimed as "end-to-end": the hospital may record. */}
          <span
            className="hidden items-center gap-1.5 sm:flex"
            title="Video and audio are encrypted in transit between you and the other participant."
          >
            <ShieldCheck size={14} strokeWidth={2} />
            Encrypted connection
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                status === "connected" ? "bg-[#3BD16F]" : "bg-[#E4483C]"
              }`}
            />
            {status === "connected"
              ? isRecording
                ? recordingMode === "audio"
                  ? "Live · audio being recorded"
                  : "Live · being recorded"
                : "Live"
              : status === "error"
                ? "Connection problem"
                : status === "ended"
                  ? "Call ended"
                  : "Not connected"}
          </span>
        </div>
      </div>

      {recordingWarning && role === "doctor" && (
        <div className="shrink-0 bg-[#2A3B44] px-4 py-2 text-center text-xs text-white lg:text-sm">
          {recordingWarning}
        </div>
      )}

      {/* Video area: takes the remaining height; never pushes the controls off screen */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#0095D9]">
        {status === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white">
            <p>Couldn't connect to the call.</p>
            <p className="text-white/60">{errorMessage}</p>
          </div>
        ) : (
          <>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              disablePictureInPicture
              controlsList="nodownload nofullscreen noremoteplayback"
              className={`absolute inset-0 h-full w-full object-contain ${away ? "blur-2xl" : ""}`}
            />

            <Watermark text={watermarkText} />

            {away && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-[#0B1A1C]/90 px-6 text-center text-sm text-white lg:text-lg">
                <EyeOff size={28} />
                The video is hidden while you&apos;re away from this window.
                <span className="text-white/70">
                  Come back to the call to see your doctor again.
                </span>
              </div>
            )}

            {countdown && (
              <div
                role="timer"
                className="absolute inset-x-3 top-3 z-20 mx-auto flex max-w-xl items-start gap-3 rounded-lg bg-[#12242C]/90 px-4 py-3 text-sm text-white shadow-lg lg:text-base"
              >
                <Timer size={22} className="mt-0.5 shrink-0 text-[#F8A86A]" />
                <span>
                  <span className="block text-xl font-bold tabular-nums lg:text-2xl">
                    {countdown.clock}
                  </span>
                  {countdown.text}
                </span>
              </div>
            )}

            {captureWarning && (
              <div
                role="alert"
                className="absolute inset-x-3 top-3 z-20 mx-auto flex max-w-xl items-start gap-2 rounded-lg bg-[#B23A3A] px-4 py-3 text-sm text-white shadow-lg lg:text-base"
              >
                <ShieldAlert size={20} className="mt-0.5 shrink-0" />
                Screenshots and recordings of consultations are not allowed.
                This attempt has been recorded by the hospital.
              </div>
            )}

            {overlay && !away && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 px-6 text-center text-sm text-white lg:text-lg">
                <Loader2 className="animate-spin" size={28} />
                {overlay}
              </div>
            )}

            {/* Own camera. Muted to avoid echo; mirrored like a mirror. */}
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute bottom-3 right-3 max-h-[35%] w-24 -scale-x-100 rounded-md border border-white/25 bg-black object-contain shadow-lg sm:w-36 lg:bottom-5 lg:right-5 lg:w-72"
            />
          </>
        )}
      </div>

      {room.state !== "open" && (
        <CallOverPanel role={role} room={room} onClose={hangUp} />
      )}

      {noticeOpen && room.state === "open" && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 text-[#12242C] shadow-xl">
            <p className="flex items-center gap-2 text-base font-semibold">
              <ShieldAlert size={20} className="text-[#B23A3A]" />
              This consultation is private
            </p>
            <p className="mt-2 text-sm text-[#3E4E56]">
              Recording this call or taking screenshots is not allowed. Your
              name and the time are shown across the picture, and the hospital
              logs capture attempts.
            </p>
            <button
              type="button"
              onClick={() => setNoticeOpen(false)}
              className="mt-4 w-full rounded-md bg-[#0095D9] px-4 py-2.5 text-sm font-semibold text-white"
            >
              I understand
            </button>
          </div>
        </div>
      )}

      {/* Controls: always visible */}
      <div
        className="flex shrink-0 items-center justify-center gap-4 bg-[#F28539] px-4 py-3 lg:gap-6 lg:py-4"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={toggleMic}
          className="flex h-12 w-12 items-center justify-center rounded-full text-white lg:h-14 lg:w-14"
          style={{ backgroundColor: micOn ? "#2A3B44" : "#E4483C" }}
          aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
          title={micOn ? "Mute microphone" : "Unmute microphone"}
        >
          {micOn ? <Mic size={20} /> : <MicOff size={20} />}
        </button>
        <button
          type="button"
          onClick={toggleCamera}
          className="flex h-12 w-12 items-center justify-center rounded-full text-white lg:h-14 lg:w-14"
          style={{ backgroundColor: cameraOn ? "#2A3B44" : "#E4483C" }}
          aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}
          title={cameraOn ? "Turn camera off" : "Turn camera on"}
        >
          {cameraOn ? <Video size={20} /> : <VideoOff size={20} />}
        </button>
        <button
          type="button"
          onClick={hangUp}
          disabled={status === "ending"}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E4483C] text-white disabled:opacity-60 lg:h-14 lg:w-14"
          aria-label="Leave call"
          title="Leave call"
        >
          <PhoneOff size={20} />
        </button>
      </div>
    </div>
  );
}
