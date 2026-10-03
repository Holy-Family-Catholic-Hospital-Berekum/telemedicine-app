import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  ShieldCheck,
  Circle,
} from "lucide-react";
import { useWebRTCCall } from "./useWebRTCCall";

import hospitalLogo from "../../src/assets/logo.png";

/**
 * VideoCallModal
 *
 * Props:
 * - consultationId: string (required)
 * - role: "doctor" | "patient" (required) — the doctor makes the WebRTC
 *   offer; the patient answers
 * - onClose: () => void (required)
 *
 * Both participants see REC whenever the server says this call is being
 * recorded (calls.recordingActive).
 */
export default function VideoCallModal({ consultationId, role, onClose }) {
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
  } = useWebRTCCall({
    consultationId,
    role,
    onEnded: onClose,
  });

  if (!consultationId) return null;

  // hangUp finishes saving the recording, then calls onClose itself.
  function handleHangUp() {
    if (status === "ending") return;
    hangUp();
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between bg-[#F28539] px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src={hospitalLogo}
            alt="Holy Family Catholic Hospital"
            className="h-6 w-6 shrink-0 rounded-full object-contain"
          />
          <span className="truncate text-xs font-medium text-white/90 sm:text-sm">
            Holy Family Catholic Hospital
          </span>
          {isRecording && (
            <span
              className="ml-1 flex shrink-0 items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[11px] font-medium text-white"
              title="This consultation is being recorded (video and audio). Only authorised hospital administrators can open recordings."
            >
              <Circle size={8} strokeWidth={0} fill="#E4483C" />
              REC
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {/* Transport encryption (DTLS-SRTP) holds even through the TURN
              relay. It's not "end-to-end" in the privacy sense when the
              hospital records the call, so the wording doesn't claim that. */}
          <div
            className="hidden items-center gap-1.5 text-xs text-white/70 sm:flex"
            title="Video and audio are encrypted in transit between you and the other participant."
          >
            <ShieldCheck size={13} strokeWidth={2} />
            Encrypted connection
          </div>

          <div className="flex items-center gap-2 text-xs text-white/70">
            <span className="inline-block h-2 w-2 rounded-full bg-[#E4483C]" />
            {status === "connecting" && "Connecting…"}
            {status === "connected" &&
              (isRecording ? "Live consultation · being recorded" : "Live consultation")}
            {status === "ending" && "Ending call…"}
            {status === "ended" && "Call ended"}
            {status === "error" && "Connection problem"}
          </div>
        </div>
      </div>

      {recordingWarning && role === "doctor" && (
        <div className="bg-[#2A3B44] px-4 py-2 text-center text-xs text-white">
          {recordingWarning}
        </div>
      )}

      <div className="relative flex-1 bg-black">
        {status === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white">
            <p>Couldn't connect to the call.</p>
            <p className="text-white/60">{errorMessage}</p>
          </div>
        ) : (
          <>
            {/* Remote participant, full-size */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="h-full w-full object-cover"
            />
            {status === "connecting" && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white">
                Waiting for the other participant to join…
              </div>
            )}

            {/* Local preview, small corner tile. muted is critical here —
                this is the #1 cause of a caller hearing their own echo:
                playing your own mic back through your own speakers. */}
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute bottom-24 right-4 h-32 w-24 rounded-md border border-white/20 object-cover sm:h-40 sm:w-32"
            />
          </>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 bg-[#F28539] px-4 py-4">
        <button
          type="button"
          onClick={toggleMic}
          className="flex h-11 w-11 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: micOn ? "#2A3B44" : "#E4483C" }}
          aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
        >
          {micOn ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        <button
          type="button"
          onClick={toggleCamera}
          className="flex h-11 w-11 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: cameraOn ? "#2A3B44" : "#E4483C" }}
          aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}
        >
          {cameraOn ? <Video size={18} /> : <VideoOff size={18} />}
        </button>
        <button
          type="button"
          onClick={handleHangUp}
          disabled={status === "ending"}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-[#E4483C] text-white"
          aria-label="Leave call"
        >
          <PhoneOff size={18} />
        </button>
      </div>
    </div>
  );
}
