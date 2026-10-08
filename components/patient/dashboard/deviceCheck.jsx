import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Video, X, AlertTriangle } from "lucide-react";

// Camera and microphone check before a patient enters the video room: they
// see themselves and a microphone level, and fix a blocked permission here
// rather than in front of the doctor. The test stream is stopped before the
// call starts its own.

const HELP = {
  NotAllowedError:
    "Your browser blocked the camera or microphone. Tap the lock or camera icon next to the web address, allow both, then tap Try again.",
  NotFoundError: "We couldn't find a camera or microphone on this device.",
  NotReadableError:
    "Another app is using your camera or microphone. Close it (for example WhatsApp or another call), then tap Try again.",
};

export default function DeviceCheck({ onReady, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [state, setState] = useState("starting"); // starting | ready | error
  const [error, setError] = useState(null);
  const [level, setLevel] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let audioCtx = null;
    let raf = 0;
    async function start() {
      setState("starting");
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        // Microphone level meter.
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
          audioCtx = new Ctx();
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          audioCtx.createMediaStreamSource(stream).connect(analyser);
          const data = new Uint8Array(analyser.fftSize);
          const tick = () => {
            analyser.getByteTimeDomainData(data);
            let peak = 0;
            for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
            setLevel(Math.min(1, peak / 64));
            raf = requestAnimationFrame(tick);
          };
          tick();
        }
        setState("ready");
      } catch (err) {
        if (!cancelled) {
          setState("error");
          setError(HELP[err?.name] || "We couldn't start your camera and microphone. Check your browser's permissions and try again.");
        }
      }
    }
    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      audioCtx?.close?.().catch(() => {});
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [attempt]);

  function stopTest() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1A1C]/60 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#DCE6EC] px-5 py-4">
          <h2 className="text-base font-semibold text-[#12242C]">Check your camera and microphone</h2>
          <button
            type="button"
            onClick={() => {
              stopTest();
              onCancel();
            }}
            aria-label="Close"
            className="text-[#3E4E56]"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">
          <div className="relative aspect-video w-full overflow-hidden rounded-md bg-[#12242C]">
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
            {state === "starting" && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white">
                <Loader2 size={20} className="mr-2 animate-spin" /> Starting your camera…
              </div>
            )}
          </div>

          {state === "error" ? (
            <div className="mt-3 flex gap-2 rounded-md bg-[#B23A3A]/10 p-3 text-sm text-[#7A2626]">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="mt-3 space-y-2 text-sm text-[#3E4E56]">
              <p className="flex items-center gap-2">
                <Video size={16} className="text-[#1E8E5A]" /> Can you see yourself above?
              </p>
              <div className="flex items-center gap-2">
                <Mic size={16} className="text-[#1E8E5A]" />
                <span>Say something: the bar should move.</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#DCE6EC]" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-[#1E8E5A] transition-[width] duration-100"
                  style={{ width: `${Math.round(level * 100)}%` }}
                />
              </div>
            </div>
          )}

          <div className="mt-4 flex gap-3">
            {state === "error" ? (
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="flex-1 rounded-md border border-[#DCE6EC] px-4 py-2.5 text-sm font-semibold text-[#12242C]"
              >
                Try again
              </button>
            ) : null}
            <button
              type="button"
              disabled={state !== "ready"}
              onClick={() => {
                stopTest();
                onReady();
              }}
              className="flex-1 rounded-md px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: "#1E8E5A" }}
            >
              Everything works: join
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
