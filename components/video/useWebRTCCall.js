// useWebRTCCall.js
import { useEffect, useRef, useState } from "react";
import { createOffer, joinCall, teardownCallSignaling } from "./signaling";

// Free STUN servers (Google's, no account needed) handle NAT traversal
// for most home/office networks.
//
// TURN is the fallback used when a direct connection can't be
// established — this is the common case for mobile data connections,
// which is exactly your patient-on-phone scenario. The credentials below
// are the Open Relay Project's public demo TURN server: fine to get you
// working today, but it's a shared, rate-limited, best-effort free
// service — NOT something to depend on for real patient consultations.
// For production, get your own TURN credentials (Metered.ca and Twilio
// both have small free/cheap tiers, or self-host coturn on the same VPS
// if you end up self-hosting anything else) and swap them in here.
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

/**
 * useWebRTCCall
 *
 * Manages one peer-to-peer call for a given consultationId. Both the
 * doctor and patient use this same hook — pass role: "doctor" (always
 * the one who starts the call / WebRTC offerer, matching your existing
 * flow where the doctor clicks "Start call" first) or "patient"
 * (answerer, joins whatever offer is already waiting).
 *
 * Returns local/remote MediaStream refs to attach to <video> elements,
 * connection status, and controls (toggleMic, toggleCamera, hangUp).
 */
export function useWebRTCCall({ consultationId, role, onEnded }) {
  const [status, setStatus] = useState("connecting"); // connecting | connected | ended | error
  const [errorMessage, setErrorMessage] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const unsubscribeSignalingRef = useRef(null);

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

        const peerConnection = new RTCPeerConnection(ICE_SERVERS);
        peerConnectionRef.current = peerConnection;

        localStream
          .getTracks()
          .forEach((track) => peerConnection.addTrack(track, localStream));

        const remoteStream = new MediaStream();
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

    start();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId, role]);

  function cleanup() {
    unsubscribeSignalingRef.current?.();
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
    toggleMic,
    toggleCamera,
    hangUp,
  };
}
