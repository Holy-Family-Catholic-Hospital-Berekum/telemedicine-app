import { Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";
import { useWebRTCCall } from "./useWebRTCCall";

/**
 * VideoCallModal
 *
 * Drop-in replacement for the Jitsi-based version — same shape of props,
 * so nothing else in DoctorDashboard.jsx or Dashboard.jsx needs to
 * change beyond passing a `role` prop now (see integration notes).
 *
 * Props:
 * - consultationId: string (required)
 * - role: "doctor" | "patient" (required) — decides who initiates the
 *   call (see webrtcSignaling.js for why the doctor always initiates)
 * - onClose: () => void (required)
 */
export default function VideoCallModal({ consultationId, role, onClose }) {
  const {
    localVideoRef,
    remoteVideoRef,
    status,
    errorMessage,
    micOn,
    cameraOn,
    toggleMic,
    toggleCamera,
    hangUp,
  } = useWebRTCCall({
    consultationId,
    role,
    onEnded: onClose,
  });

  if (!consultationId) return null;

  function handleHangUp() {
    hangUp();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between bg-[#12242C] px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-white/70">
          <span className="inline-block h-2 w-2 rounded-full bg-[#E4483C]" />
          {status === "connecting" && "Connecting…"}
          {status === "connected" && "Live consultation · not recorded"}
          {status === "ended" && "Call ended"}
          {status === "error" && "Connection problem"}
        </div>
      </div>

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

      <div className="flex items-center justify-center gap-3 bg-[#12242C] px-4 py-4">
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
          className="flex h-11 w-11 items-center justify-center rounded-full bg-[#E4483C] text-white"
          aria-label="Leave call"
        >
          <PhoneOff size={18} />
        </button>
      </div>
    </div>
  );
}
