// useWebRTCCall.js
import { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../src/firebase";
import { createOffer, joinCall, teardownCallSignaling } from "./signaling";
import { createCompositeRecorder } from "./callRecording";
import { isCallRecordingEnabled } from "./featureFlags";

// Google's free STUN server. Used both as part of the normal ICE server
// list and as the fallback if fetching TURN credentials fails — STUN
// alone still lets most direct connections succeed, so a TURN outage
// degrades the call rather than blocking it outright.
const STUN_ONLY_FALLBACK = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// Fetches short-lived TURN credentials from the getTurnCredentials
// Cloud Function (see functions/getTurnCredentials.js) instead of
// hardcoding a secret in the frontend. Cloudflare's response already
// includes their STUN servers too, so this alone is normally a
// complete ICE server list.
async function fetchIceServers() {
  try {
    const call = httpsCallable(functions, "getTurnCredentials");
    const result = await call();
    return { iceServers: result.data.iceServers };
  } catch (err) {
    console.warn("Couldn't fetch TURN credentials, falling back to STUN only:", err);
    return STUN_ONLY_FALLBACK;
  }
}

/**
 * useWebRTCCall
 *
 * Manages one peer-to-peer call for a given consultationId. Both the
 * doctor and patient use this same hook — pass role: "doctor" (always
 * the one who starts the call / WebRTC offerer, matching your existing
 * flow where the doctor clicks "Start call" first) or "patient"
 * (answerer, joins whatever offer is already waiting).
 *
 * Recording (when the systemSettings/features.callRecordingEnabled flag
 * is on) runs only on the doctor's side — see callRecording.js for why.
 *
 * Returns local/remote MediaStream refs to attach to <video> elements,
 * connection status, recording status, and controls (toggleMic,
 * toggleCamera, hangUp).
 */
export function useWebRTCCall({ consultationId, role, onEnded }) {
  const [status, setStatus] = useState("connecting"); // connecting | connected | ended | error
  const [errorMessage, setErrorMessage] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [isRecording, setIsRecording] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const unsubscribeSignalingRef = useRef(null);
  const recorderRef = useRef(null);
  const recordingStartedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        // echoCancellation/noiseSuppression/autoGainControl are the
        // browser's built-in audio processing — this is the actual fix
        // for echo, not which platform you're using. They're on by
        // default in most browsers, but setting them explicitly makes
        // sure nothing silently turns them off.
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

        const peerConnection = new RTCPeerConnection(await fetchIceServers());
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

        if (role === "doctor") {
          unsubscribeSignalingRef.current = await createOffer(
            consultationId,
            peerConnection,
          );
        } else {
          unsubscribeSignalingRef.current = await joinCall(
            consultationId,
            peerConnection,
          );
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(
            err.message?.includes("Permission")
              ? "Camera/microphone permission was blocked. Allow access and try again."
              : err.message || "Couldn't start the call.",
          );
        }
      }
    }

    async function maybeStartRecording() {
      // One recording per consultation: only the doctor's client
      // records (see callRecording.js), and only once per call even if
      // connectionstatechange fires more than once.
      if (role !== "doctor" || recordingStartedRef.current || cancelled) {
        return;
      }
      const enabled = await isCallRecordingEnabled();
      if (!enabled || cancelled || recordingStartedRef.current) return;

      recordingStartedRef.current = true;
      const recorder = createCompositeRecorder({
        consultationId,
        localVideoEl: localVideoRef.current,
        remoteVideoEl: remoteVideoRef.current,
        localStream: localStreamRef.current,
        remoteStream: remoteStreamRef.current,
        onError: (err) => {
          console.error("Call recording error:", err);
        },
      });
      recorderRef.current = recorder;
      await recorder.start();
      if (!cancelled) setIsRecording(true);
    }

    start();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId, role]);

  function cleanup() {
    unsubscribeSignalingRef.current?.();
    // Fire-and-forget: stopping a recording finishes its upload
    // asynchronously, which shouldn't block tearing down the call UI.
    if (recorderRef.current) {
      recorderRef.current.stop().catch((err) => {
        console.error("Failed to finalize call recording:", err);
      });
      recorderRef.current = null;
    }
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

  function hangUp() {
    cleanup();
    // Whoever hangs up clears the shared signaling doc; harmless if the
    // other side also calls this on their own hangup.
    teardownCallSignaling(consultationId);
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
    toggleMic,
    toggleCamera,
    hangUp,
  };
}
