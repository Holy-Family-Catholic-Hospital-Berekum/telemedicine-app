import { useEffect, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  ShieldCheck,
  Circle,
  Loader2,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useWebRTCCall } from "./useWebRTCCall";
import hospitalLogo from "../../src/assets/logo.png";

// How far "Fill" may zoom past showing the whole picture. When the two
// screens have similar shapes (laptop and TV, or two phones) this is enough
// to fill the screen edge to edge. A portrait phone on a landscape TV would
// need about 3x, which cuts off the patient's head and chin, so the zoom
// stops here and a blurred copy of the same video fills the sides.
const MAX_FILL_ZOOM = 2;

/**
 * VideoCallModal — full-screen call view, laid out for a phone, a laptop or
 * a TV in the consulting room.
 *
 * - The other person's video fills the screen ("Fill", the default): it is
 *   zoomed until it covers the video area, up to MAX_FILL_ZOOM, keeping the
 *   upper middle (where faces are) in view. Any space left is filled with a
 *   blurred copy of the same video, never an empty background.
 * - "Fit" shows the whole picture uncropped, e.g. when the patient shows
 *   something near the edge of their camera.
 * - Header and controls are fixed bars; the video area takes what's left,
 *   so the controls are always on screen.
 * - Own camera is a mirrored picture-in-picture, larger on big screens.
 *
 * Props: consultationId, role ("doctor" | "patient"),
 *        patientSeq (patient only, from startVideoCall), onClose
 */
export default function VideoCallModal({
  consultationId,
  role,
  patientSeq,
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

  const areaRef = useRef(null);
  const backdropRef = useRef(null);
  const [fill, setFill] = useState(true);
  const [zoom, setZoom] = useState(1);

  // Works out the "Fill" zoom from the video area and the incoming video's
  // shape, and mirrors the incoming stream into the blurred backdrop.
  // Re-runs on window resize, rotation, and when the other side's camera
  // changes shape or reconnects.
  useEffect(() => {
    const area = areaRef.current;
    const video = remoteVideoRef.current;
    if (!area || !video) return undefined;

    const update = (event) => {
      const backdrop = backdropRef.current;
      // Same stream object after a reconnect, but with new tracks:
      // re-attach, like useWebRTCCall does for the main picture.
      if (backdrop && (backdrop.srcObject !== video.srcObject || event?.type === "loadedmetadata")) {
        backdrop.srcObject = null;
        backdrop.srcObject = video.srcObject;
        backdrop.play?.().catch(() => {});
      }
      const W = area.clientWidth;
      const H = area.clientHeight;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!W || !H || !w || !h) return;
      const contain = Math.min(W / w, H / h);
      const cover = Math.max(W / w, H / h);
      setZoom(Math.min(cover / contain, MAX_FILL_ZOOM));
    };

    const observer = new ResizeObserver(update);
    observer.observe(area);
    const events = ["loadedmetadata", "resize", "emptied", "playing"];
    events.forEach((e) => video.addEventListener(e, update));
    update();
    return () => {
      observer.disconnect();
      events.forEach((e) => video.removeEventListener(e, update));
    };
  }, [remoteVideoRef, status]);

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
      <div ref={areaRef} className="relative min-h-0 flex-1 overflow-hidden bg-black">
        {status === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white">
            <p>Couldn't connect to the call.</p>
            <p className="text-white/60">{errorMessage}</p>
          </div>
        ) : (
          <>
            {/* Blurred copy of the other person's video behind the main
                picture, so no part of the screen is left empty. */}
            <video
              ref={backdropRef}
              autoPlay
              playsInline
              muted
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-2xl"
            />
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="absolute inset-0 h-full w-full object-contain transition-transform duration-300"
              style={{
                transform: `scale(${fill ? zoom : 1})`,
                // Zoom around the upper middle so heads stay in the frame.
                transformOrigin: "50% 40%",
              }}
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
          onClick={() => setFill((v) => !v)}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#2A3B44] text-white lg:h-14 lg:w-14"
          aria-label={fill ? "Show the whole picture" : "Fill the screen"}
          title={fill ? "Show the whole picture" : "Fill the screen"}
          aria-pressed={!fill}
        >
          {fill ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
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
