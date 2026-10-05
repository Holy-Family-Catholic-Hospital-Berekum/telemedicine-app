import { useEffect, useState } from "react";
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
} from "lucide-react";
import { useWebRTCCall } from "./useWebRTCCall";
import hospitalLogo from "../../src/assets/logo.png";
import { functions } from "../../src/firebase";
import { useAuth } from "../../src/context/authContext.jsx";

const callReportCapture = httpsCallable(functions, "reportCaptureAttempt");

// Screen capture. A web page can't stop the operating system, another app
// or a second phone from capturing the screen, so this is deterrence:
// - the other person's video carries a watermark with the viewer's name
//   and the date and time, so any capture identifies who made it;
// - screenshot / screen-recording shortcuts the browser can see (Print
//   Screen; Cmd+Shift+3/4/5 on Mac; Win+Shift+S / Win+Alt+R are usually
//   taken by Windows first) show a warning and are logged to the audit tab
//   (reportCaptureAttempt);
// - right-click (save video), picture-in-picture and dragging are off.
// The hospital's own recording (callRecording.js) is unaffected.
function captureMethod(e) {
  const key = String(e.key || "");
  if (key === "PrintScreen" || e.code === "PrintScreen") return "print_screen";
  if (e.metaKey && e.shiftKey && ["3", "4"].includes(key)) return "screenshot_shortcut";
  if (e.metaKey && e.shiftKey && key === "5") return "record_shortcut";
  if (e.metaKey && e.shiftKey && key.toLowerCase() === "s") return "screenshot_shortcut";
  if (e.metaKey && e.altKey && key.toLowerCase() === "r") return "record_shortcut";
  return null;
}

function Watermark({ text }) {
  // Tiled, faint and diagonal: readable in a capture, not in the way.
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 select-none overflow-hidden"
    >
      <div className="absolute -inset-1/2 flex rotate-[-24deg] flex-wrap content-center gap-x-24 gap-y-20 opacity-[0.16]">
        {Array.from({ length: 40 }, (_, i) => (
          <span key={i} className="whitespace-nowrap text-sm font-semibold text-white lg:text-lg">
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
 *        (for the anti-capture watermark), onClose
 */
export default function VideoCallModal({
  consultationId,
  role,
  patientSeq,
  viewerName,
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

  // Keeps the watermark's time current.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

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

  const watermarkText = `${viewerName || (role === "doctor" ? "Doctor" : "Patient")} · ${now.toLocaleString("en-GB", {
    timeZone: "Africa/Accra",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })} · Confidential`;

  const other = role === "doctor" ? "patient" : "doctor";
  const overlay =
    status === "connecting"
      ? "Connecting…"
      : status === "waiting"
        ? `Waiting for the ${other} to join…`
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
              className="absolute inset-0 h-full w-full object-contain"
            />

            <Watermark text={watermarkText} />

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

            {overlay && (
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
