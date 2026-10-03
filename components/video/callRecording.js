// callRecording.js
//
// Records a consultation from the doctor's browser. Calls are peer-to-peer
// WebRTC with no media server, so recording both people means compositing
// what is already on screen:
//   - video: the remote video, scaled to fit (letterboxed, never cropped or
//     stretched), plus the doctor's own camera as a small picture-in-picture,
//     drawn onto a canvas
//   - audio: every live audio track from both sides, mixed with Web Audio
//
// Whether and how to record is decided by the server, never here:
// startRecording returns { recording: false } unless an admin had recording
// on when the call started, and otherwise the mode: "video" (composited
// picture plus both voices) or "audio" (both voices only, no canvas at
// all). Doctors and patients have no control over it.
//
// Performance: frames are drawn at DRAW_FPS from a Web Worker timer rather
// than requestAnimationFrame. rAF runs at the screen rate (60+ Hz), which
// was what made laptops freeze, and it stops entirely when the tab is in the
// background, which froze the recording. Worker timers keep running.
//
// Upload is segmented: every SEGMENT_MS the recorder emits a chunk, which is
// uploaded straight away to recordings/{recordingId}/parts/NNNNNN.webm
// (Storage rules allow only this doctor to create parts for this recording,
// and nobody to read them). A crash or closed tab loses at most one segment;
// the server's hourly recovery job finishes any recording left open. On
// stop, finalizeRecording stitches the parts into one file and hashes it.
import { httpsCallable } from "firebase/functions";
import { ref as storageRef, uploadBytes } from "firebase/storage";
import { functions, storage } from "../../src/firebase";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const PIP_MAX_WIDTH = 280;
const PIP_MAX_HEIGHT = 210;
const PIP_MARGIN = 20;
const DRAW_FPS = 15;
const SEGMENT_MS = 30_000;
// About 5 MB per minute: clear faces and speech, modest storage.
const VIDEO_BITS_PER_SECOND = 650_000;
const AUDIO_BITS_PER_SECOND = 64_000;
const UPLOAD_RETRIES = 4;

const callStartRecording = httpsCallable(functions, "startRecording");
const callFinalizeRecording = httpsCallable(functions, "finalizeRecording");

function pickSupportedMimeType(mode) {
  // VP8 first: far cheaper to encode than VP9 on ordinary laptops.
  const candidates =
    mode === "audio"
      ? ["audio/webm;codecs=opus", "audio/webm"]
      : ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported(type)) || "";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A timer that keeps ticking in background tabs (worker timers aren't paused). */
function createTicker(fps, onTick) {
  const source = `let t=setInterval(()=>postMessage(0),${Math.round(1000 / fps)});onmessage=()=>clearInterval(t);`;
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(url);
  worker.onmessage = onTick;
  return () => {
    worker.postMessage("stop");
    worker.terminate();
    URL.revokeObjectURL(url);
  };
}

/** Draws `video` inside the box, keeping its aspect ratio. */
function drawContained(ctx, video, x, y, w, h) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.min(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/**
 * Usage: const recorder = createCompositeRecorder({...});
 *        const { recording } = await recorder.start();
 *        recorder.syncAudio();   // after the remote tracks change
 *        await recorder.stop();
 */
export function createCompositeRecorder({
  consultationId,
  localVideoEl,
  remoteVideoEl,
  localStream,
  remoteStream,
  onError,
}) {
  let canvas, ctx, canvasStream, audioCtx, audioDestination;
  const audioSources = new Map(); // trackId -> MediaStreamAudioSourceNode
  let mediaRecorder;
  let stopTicker = null;
  let recordingId = null;
  let mode = "video";
  let partIndex = 0;
  let stopped = false;
  let uploadChain = Promise.resolve();

  function drawFrame() {
    if (stopped) return;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (remoteVideoEl && remoteVideoEl.readyState >= 2) {
      drawContained(ctx, remoteVideoEl, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    if (localVideoEl && localVideoEl.readyState >= 2 && localVideoEl.videoWidth) {
      const scale = Math.min(
        PIP_MAX_WIDTH / localVideoEl.videoWidth,
        PIP_MAX_HEIGHT / localVideoEl.videoHeight,
      );
      const w = localVideoEl.videoWidth * scale;
      const h = localVideoEl.videoHeight * scale;
      ctx.drawImage(
        localVideoEl,
        CANVAS_WIDTH - w - PIP_MARGIN,
        CANVAS_HEIGHT - h - PIP_MARGIN,
        w,
        h,
      );
    }
  }

  /** Mixes in any live audio track not yet in the recording. */
  function syncAudio() {
    if (!audioCtx || stopped) return;
    const live = new Set();
    for (const stream of [localStream, remoteStream]) {
      for (const track of stream?.getAudioTracks() || []) {
        if (track.readyState !== "live") continue;
        live.add(track.id);
        if (!audioSources.has(track.id)) {
          const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
          source.connect(audioDestination);
          audioSources.set(track.id, source);
        }
      }
    }
    for (const [id, source] of audioSources) {
      if (!live.has(id)) {
        source.disconnect();
        audioSources.delete(id);
      }
    }
  }

  async function uploadPart(blob, index) {
    const name = String(index).padStart(6, "0");
    const fileRef = storageRef(storage, `recordings/${recordingId}/parts/${name}.webm`);
    for (let attempt = 0; attempt <= UPLOAD_RETRIES; attempt++) {
      try {
        await uploadBytes(fileRef, blob, {
          contentType: mode === "audio" ? "audio/webm" : "video/webm",
        });
        return;
      } catch (err) {
        if (attempt === UPLOAD_RETRIES) {
          onError?.(new Error(`Recording segment ${name} failed to upload: ${err.code || err.message}`));
          return;
        }
        await sleep(1000 * 2 ** attempt);
      }
    }
  }

  function enqueue(blob) {
    partIndex += 1;
    const index = partIndex;
    uploadChain = uploadChain.then(() => uploadPart(blob, index));
  }

  /** Resolves { recording: boolean, mode }. */
  async function start() {
    const { data } = await callStartRecording({ consultationId });
    if (!data?.recording) return { recording: false };
    recordingId = data.recordingId;
    mode = data.mode === "audio" ? "audio" : "video";

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioDestination = audioCtx.createMediaStreamDestination();
    syncAudio();

    const tracks = [...audioDestination.stream.getAudioTracks()];
    if (mode === "video") {
      canvas = document.createElement("canvas");
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;
      ctx = canvas.getContext("2d", { alpha: false });
      canvasStream = canvas.captureStream(DRAW_FPS);
      tracks.unshift(...canvasStream.getVideoTracks());
    }

    const mimeType = pickSupportedMimeType(mode);
    mediaRecorder = new MediaRecorder(new MediaStream(tracks), {
      ...(mimeType ? { mimeType } : {}),
      ...(mode === "video" ? { videoBitsPerSecond: VIDEO_BITS_PER_SECOND } : {}),
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) enqueue(event.data);
    };
    mediaRecorder.onerror = (event) => onError?.(event.error || new Error("Recorder error"));

    if (mode === "video") {
      drawFrame();
      stopTicker = createTicker(DRAW_FPS, drawFrame);
    }
    mediaRecorder.start(SEGMENT_MS);
    return { recording: true, mode };
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    stopTicker?.();

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      await new Promise((resolve) => {
        mediaRecorder.addEventListener("stop", resolve, { once: true });
        mediaRecorder.stop(); // emits the last chunk before "stop"
      });
    }
    canvasStream?.getTracks().forEach((t) => t.stop());
    await audioCtx?.close().catch(() => {});

    if (!recordingId) return;
    await uploadChain;
    try {
      await callFinalizeRecording({ recordingId });
    } catch (err) {
      // The server's recovery job will finish it; still worth surfacing.
      onError?.(err);
    }
  }

  return { start, stop, syncAudio };
}
