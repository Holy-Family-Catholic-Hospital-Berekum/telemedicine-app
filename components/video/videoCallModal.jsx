import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  ShieldCheck,
  Circle,
  Loader2,
} from "lucide-react";
import { useWebRTCCall } from "./useWebRTCCall";
import hospitalLogo from "../../src/assets/logo.png";

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
 *        patientSeq (patient only, from startVideoCall), onClose
 */
export default function VideoCallModal({ consultationId, role, patientSeq, onClose }) {
  const {
    localVideoRef,
    remoteVideoRef,
    status,
    errorMessage,
    micOn,
    cameraOn,
    isRecording,
    recordingWarning,
    toggleMic,
    toggleCamera,
    hangUp,
  } = useWebRTCCall({ consultationId, role, patientSeq, onEnded: onClose });

  if (!consultationId) return null;

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
    <div className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-black">
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
              title="This consultation is being recorded (video and audio). Only authorised hospital administrators can open recordings."
            >
              <Circle size={8} strokeWidth={0} fill="#E4483C" className="animate-pulse" />
              REC
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
                ? "Live · being recorded"
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
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
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
              className="absolute inset-0 h-full w-full object-contain"
            />

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
