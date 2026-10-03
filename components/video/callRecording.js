// callRecording.js
//
// Records a consultation from the doctor's browser. Calls are peer-to-peer
// WebRTC with no media server, so recording both people means compositing
// what is already on screen:
//   - video: the remote and local <video> elements drawn onto a canvas
//     (full-frame remote + small local picture-in-picture)
//   - audio: both audio tracks mixed with the Web Audio API
//
// Whether to record is decided by the server, never here: startRecording
// returns { recording: false } unless an admin had call recording switched
// on when the call started. Doctors and patients have no control over it.
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
const PIP_WIDTH = 240;
const PIP_HEIGHT = 180;
const PIP_MARGIN = 24;
const CANVAS_FPS = 24;
const SEGMENT_MS = 30_000;
// Caps storage at roughly 5 MB per minute.
const VIDEO_BITS_PER_SECOND = 600_000;
const AUDIO_BITS_PER_SECOND = 64_000;
const UPLOAD_RETRIES = 4;

const callStartRecording = httpsCallable(functions, "startRecording");
const callFinalizeRecording = httpsCallable(functions, "finalizeRecording");

function pickSupportedMimeType() {
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
  return (
    candidates.find((type) => window.MediaRecorder?.isTypeSupported(type)) ||
    ""
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Usage: const recorder = createCompositeRecorder({...});
 *        const { recording } = await recorder.start();
 *        ... await recorder.stop();
 *
 * stop() resolves once every segment has been uploaded (or given up on)
 * and the server has been asked to finalise.
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
  let localAudioSource = null;
  let remoteAudioSource = null;
  let remoteAudioAttachInterval = null;
  let mediaRecorder;
  let drawHandle = null;
  let recordingId = null;
  let partIndex = 0;
  let stopped = false;
  // Uploads run one after another so parts arrive in order.
  let uploadChain = Promise.resolve();

  function drawFrame() {
    if (stopped) return;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (remoteVideoEl && remoteVideoEl.readyState >= 2) {
      ctx.drawImage(remoteVideoEl, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    if (localVideoEl && localVideoEl.readyState >= 2) {
      ctx.drawImage(
        localVideoEl,
        CANVAS_WIDTH - PIP_WIDTH - PIP_MARGIN,
        CANVAS_HEIGHT - PIP_HEIGHT - PIP_MARGIN,
        PIP_WIDTH,
        PIP_HEIGHT,
      );
    }
    drawHandle = requestAnimationFrame(drawFrame);
  }

  function tryAttachAudio(stream, existingSource) {
    if (existingSource || !stream || !audioCtx) return existingSource;
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return existingSource;
    const source = audioCtx.createMediaStreamSource(new MediaStream(audioTracks));
    source.connect(audioDestination);
    return source;
  }

  async function uploadPart(blob, index) {
    const name = String(index).padStart(6, "0");
    const fileRef = storageRef(storage, `recordings/${recordingId}/parts/${name}.webm`);
    for (let attempt = 0; attempt <= UPLOAD_RETRIES; attempt++) {
      try {
        await uploadBytes(fileRef, blob, { contentType: "video/webm" });
        return;
      } catch (err) {
        if (attempt === UPLOAD_RETRIES) {
          onError?.(new Error(`Recording segment ${name} failed to upload: ${err.message}`));
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

  /** Resolves { recording: boolean }. */
  async function start() {
    const { data } = await callStartRecording({ consultationId });
    if (!data?.recording) return { recording: false };
    recordingId = data.recordingId;

    canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    ctx = canvas.getContext("2d");
    canvasStream = canvas.captureStream(CANVAS_FPS);

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioDestination = audioCtx.createMediaStreamDestination();

    localAudioSource = tryAttachAudio(localStream, localAudioSource);
    remoteAudioSource = tryAttachAudio(remoteStream, remoteAudioSource);
    // The remote audio track can arrive a moment after "connected".
    let attempts = 0;
    remoteAudioAttachInterval = setInterval(() => {
      remoteAudioSource = tryAttachAudio(remoteStream, remoteAudioSource);
      attempts += 1;
      if (remoteAudioSource || attempts > 10) clearInterval(remoteAudioAttachInterval);
    }, 500);

    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks(),
    ]);

    const mimeType = pickSupportedMimeType();
    mediaRecorder = new MediaRecorder(combinedStream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) enqueue(event.data);
    };
    mediaRecorder.onerror = (event) => onError?.(event.error || new Error("Recorder error"));

    mediaRecorder.start(SEGMENT_MS);
    drawFrame();
    return { recording: true };
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    if (drawHandle) cancelAnimationFrame(drawHandle);
    if (remoteAudioAttachInterval) clearInterval(remoteAudioAttachInterval);

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

  return { start, stop, isActive: () => Boolean(recordingId) && !stopped };
}
