// callRecording.js
//
// Client-side call recording. There's no media server in this
// architecture (calls are direct peer-to-peer WebRTC, signaled through
// Firestore — see signaling.firebase.js), so recording both
// participants means compositing what's already in the browser:
//   - video: draw the local + remote <video> elements onto an offscreen
//     canvas every frame (full-frame remote + small local PiP, mirroring
//     the on-screen layout in VideoCallModal.jsx), then canvas.captureStream()
//   - audio: mix the local + remote audio tracks with the Web Audio API
//     into a single MediaStreamDestination
//   - MediaRecorder records the combined video+audio stream and uploads
//     the result to Firebase Storage when the call ends
//
// Runs on the doctor's client only (see useWebRTCCall.js) — one
// recording per consultation, not one per participant.
//
// SECURITY NOTE: this file can WRITE a recording, but nothing here
// grants READ access. Read access ("only admin can access", per the
// product requirement) has to be enforced in Firestore/Storage security
// rules, not in this client code — see firebase-rules-recordings.md.
import {
  doc,
  addDoc,
  updateDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes } from "firebase/storage";
import { db } from "../../src/firebase";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const PIP_WIDTH = 240;
const PIP_HEIGHT = 180;
const PIP_MARGIN = 24;
const CANVAS_FPS = 24;

function pickSupportedMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return (
    candidates.find((type) => window.MediaRecorder?.isTypeSupported(type)) ||
    ""
  );
}

/**
 * Creates a recorder bound to the given local/remote <video> elements and
 * MediaStreams (the same ones already driving the on-screen call UI).
 *
 * Usage: const recorder = createCompositeRecorder({...}); await recorder.start();
 * ... later ... await recorder.stop();
 *
 * start() and stop() are both async — stop() doesn't resolve until the
 * upload attempt has finished (success or failure), so callers should
 * await it before tearing down anything else the recording depends on.
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
  let chunks = [];
  let drawHandle = null;
  let recordingDocId = null;
  let startedAt = null;
  let stopped = false;

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

  // Attaches a stream's audio track to the mix, if it has one and isn't
  // already attached. Returns the source node (or the existing one).
  function tryAttachAudio(stream, existingSource) {
    if (existingSource || !stream || !audioCtx) return existingSource;
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return existingSource;
    const source = audioCtx.createMediaStreamSource(
      new MediaStream(audioTracks),
    );
    source.connect(audioDestination);
    return source;
  }

  async function start() {
    try {
      canvas = document.createElement("canvas");
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;
      ctx = canvas.getContext("2d");
      canvasStream = canvas.captureStream(CANVAS_FPS);

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioDestination = audioCtx.createMediaStreamDestination();

      localAudioSource = tryAttachAudio(localStream, localAudioSource);
      remoteAudioSource = tryAttachAudio(remoteStream, remoteAudioSource);
      // The remote audio track can arrive a moment after "connected"
      // fires, so keep trying for a few seconds rather than missing it.
      let attempts = 0;
      remoteAudioAttachInterval = setInterval(() => {
        remoteAudioSource = tryAttachAudio(remoteStream, remoteAudioSource);
        attempts += 1;
        if (remoteAudioSource || attempts > 10) {
          clearInterval(remoteAudioAttachInterval);
        }
      }, 500);

      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks(),
      ]);

      const mimeType = pickSupportedMimeType();
      mediaRecorder = new MediaRecorder(
        combinedStream,
        mimeType ? { mimeType } : undefined,
      );
      chunks = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };

      startedAt = Date.now();
      // Medical-record metadata doc — kept indefinitely, no TTL (unlike
      // the ephemeral call-signaling docs in signaling.firebase.js).
      const metaDoc = await addDoc(collection(db, "recordings"), {
        consultationId,
        startedAt: serverTimestamp(),
        status: "recording",
      });
      recordingDocId = metaDoc.id;

      mediaRecorder.start(1000); // 1s timeslices so chunks survive a mid-call crash
      drawFrame();
    } catch (err) {
      onError?.(err);
    }
  }

  async function stop() {
    stopped = true;
    if (drawHandle) cancelAnimationFrame(drawHandle);
    if (remoteAudioAttachInterval) clearInterval(remoteAudioAttachInterval);

    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      await audioCtx?.close().catch(() => {});
      return;
    }

    const blob = await new Promise((resolve) => {
      mediaRecorder.addEventListener(
        "stop",
        () => resolve(new Blob(chunks, { type: mediaRecorder.mimeType })),
        { once: true },
      );
      mediaRecorder.stop();
    });
    await audioCtx?.close().catch(() => {});

    try {
      const storage = getStorage();
      const path = `recordings/${consultationId}/${startedAt}.webm`;
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, blob, {
        contentType: blob.type || "video/webm",
      });

      if (recordingDocId) {
        await updateDoc(doc(db, "recordings", recordingDocId), {
          status: "uploaded",
          storagePath: path,
          endedAt: serverTimestamp(),
          sizeBytes: blob.size,
        });
      }
    } catch (err) {
      if (recordingDocId) {
        await updateDoc(doc(db, "recordings", recordingDocId), {
          status: "upload_failed",
          endedAt: serverTimestamp(),
        }).catch(() => {});
      }
      onError?.(err);
    }
  }

  return { start, stop };
}
