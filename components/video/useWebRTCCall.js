// useWebRTCCall.js
import { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../src/firebase";
import { createOffer, joinCall, watchRecordingState } from "./signaling";
import { createCompositeRecorder } from "./callRecording";

// Google's free STUN server: the fallback if TURN credentials can't be
// fetched. STUN alone still connects most calls.
const STUN_ONLY_FALLBACK = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// Longest we wait for the last recording segment to upload on hang-up.
const FINALIZE_WAIT_MS = 20_000;

const callGetTurnCredentials = httpsCallable(functions, "getTurnCredentials");

// Short-lived TURN credentials, issued only to a participant of this
// consultation (functions/consultations.js getTurnCredentials).
async function fetchIceServers(consultationId) {
  try {
    const result = await callGetTurnCredentials({ consultationId });
    return { iceServers: result.data.iceServers };
  } catch (err) {
    console.warn("Couldn't fetch TURN credentials, falling back to STUN only:", err);
    return STUN_ONLY_FALLBACK;
  }
}

/**
 * useWebRTCCall
 *
 * One peer-to-peer call for a consultation. startVideoCall must already
 * have succeeded for this user (it creates the signalling room).
 *
 *   role "doctor"  -> makes the WebRTC offer, and asks the server to record
 *   role "patient" -> answers the doctor's offer
 *
 * Recording is decided by the server (the admin switch), never by either
 * participant. `isRecording` follows the server-set calls.recordingActive
 * flag, so the patient sees REC exactly when the doctor's side is recording.
 */
export function useWebRTCCall({ consultationId, role, onEnded }) {
  const [status, setStatus] = useState("connecting"); // connecting | connected | ending | ended | error
  const [errorMessage, setErrorMessage] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingWarning, setRecordingWarning] = useState("");

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const unsubscribeSignalingRef = useRef(null);
  const recorderRef = useRef(null);
  const recordingStartedRef = useRef(false);

  // REC indicator for both sides, straight from the server's flag.
  useEffect(() => {
    if (!consultationId) return undefined;
    return watchRecordingState(consultationId, setIsRecording);
  }, [consultationId]);

  // Warn before closing the tab mid-recording: it would cut the recording.
  useEffect(() => {
    if (!isRecording || role !== "doctor") return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isRecording, role]);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) {
          localStream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = localStream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }

        const peerConnection = new RTCPeerConnection(
          await fetchIceServers(consultationId),
        );
        peerConnectionRef.current = peerConnection;

        localStream
          .getTracks()
          .forEach((track) => peerConnection.addTrack(track, localStream));

        const remoteStream = new MediaStream();
        remoteStreamRef.current = remoteStream;
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
        peerConnection.addEventListener("track", (event) => {
          event.streams[0].getTracks().forEach((track) => {
            remoteStream.addTrack(track);
          });
        });

        peerConnection.addEventListener("connectionstatechange", () => {
          if (cancelled) return;
          if (peerConnection.connectionState === "connected") {
            setStatus("connected");
            maybeStartRecording();
          } else if (
            ["failed", "disconnected", "closed"].includes(
              peerConnection.connectionState,
            )
          ) {
            setStatus("ended");
            onEnded?.();
          }
        });

        unsubscribeSignalingRef.current =
          role === "doctor"
            ? await createOffer(consultationId, peerConnection)
            : await joinCall(consultationId, peerConnection);
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(
            err.name === "NotAllowedError"
              ? "Camera/microphone permission was blocked. Allow access and try again."
              : err.message || "Couldn't start the call.",
          );
        }
      }
    }

    async function maybeStartRecording() {
      // One recording per call, from the doctor's browser only.
      if (role !== "doctor" || recordingStartedRef.current || cancelled) return;
      recordingStartedRef.current = true;

      const recorder = createCompositeRecorder({
        consultationId,
        localVideoEl: localVideoRef.current,
        remoteVideoEl: remoteVideoRef.current,
        localStream: localStreamRef.current,
        remoteStream: remoteStreamRef.current,
        onError: (err) => {
          console.error("Call recording error:", err);
          setRecordingWarning(
            "There was a problem saving part of the recording. The call can continue.",
          );
        },
      });
      recorderRef.current = recorder;
      try {
        await recorder.start();
      } catch (err) {
        // Failure policy: the call continues; the server logs the gap.
        console.error("Recording didn't start:", err);
        recorderRef.current = null;
        if (!cancelled) {
          setRecordingWarning(
            "Recording couldn't start. The call can continue; the hospital has been notified.",
          );
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId, role]);

  function stopRecorder() {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return Promise.resolve();
    return recorder.stop().catch((err) => {
      console.error("Failed to finalise call recording:", err);
    });
  }

  function cleanup() {
    unsubscribeSignalingRef.current?.();
    unsubscribeSignalingRef.current = null;
    // On unmount we can't wait; uploads keep going while the page is open
    // and the server recovers anything left unfinished.
    stopRecorder();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    peerConnectionRef.current?.close();
  }

  function toggleMic() {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    setMicOn(audioTrack.enabled);
  }

  function toggleCamera() {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (!videoTrack) return;
    videoTrack.enabled = !videoTrack.enabled;
    setCameraOn(videoTrack.enabled);
  }

  // Finish the recording (last segment + finalise) before tearing down.
  async function hangUp() {
    setStatus("ending");
    await Promise.race([
      stopRecorder(),
      new Promise((r) => setTimeout(r, FINALIZE_WAIT_MS)),
    ]);
    cleanup();
    setStatus("ended");
    onEnded?.();
  }

  return {
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
  };
}
