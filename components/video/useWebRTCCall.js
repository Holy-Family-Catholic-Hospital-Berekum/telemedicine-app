// useWebRTCCall.js
//
// One peer-to-peer video call for a consultation, for either side.
// startVideoCall must already have succeeded for this user (it opens the
// signalling room and, for the patient, returns `patientSeq`).
//
// PROTOCOL (calls/{consultationId}, see signaling.firebase.js)
//   - The doctor always offers: offer = { type, sdp, id, seq }.
//   - The patient answers only an offer whose seq equals its own patientSeq
//     and that it hasn't answered yet: answer = { type, sdp, id, offerId }.
//   - Each patient (re)join bumps patientSeq on the server and clears the
//     answer. The doctor sees the bump and offers again with the new seq.
//   - A doctor (re)join clears offer + answer on the server; the doctor's
//     fresh offer carries the current seq, so a patient already in the
//     call simply answers it.
//   - ICE candidates carry the id of the offer/answer they belong to, so
//     candidates from an earlier attempt are ignored.
//   - Hanging up writes offer/answer = null, so the other side shows
//     "waiting" instead of a frozen picture.
//   - Network trouble: "disconnected" usually heals by itself. On "failed"
//     the doctor offers again; if the patient stays stuck it re-joins
//     (bumping seq), which makes the doctor offer again.
//
// Recording runs only in the doctor's browser and only if the server says
// so (the admin switch). Both sides show REC from calls.recordingActive.
import { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../src/firebase";
import {
  watchCall,
  writeOffer,
  writeAnswer,
  addCandidate,
  watchCandidates,
} from "./signaling";
import { createCompositeRecorder } from "./callRecording";

const STUN_ONLY = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
const FINALIZE_WAIT_MS = 20_000;
const PATIENT_RESTART_AFTER_MS = 15_000;

// 720p at up to 30 fps; phones give the same in portrait. Sharp enough for
// a consultation on a TV without overloading ordinary laptops.
const VIDEO_CONSTRAINTS = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 24, max: 30 },
  facingMode: "user",
};
const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
const MAX_VIDEO_BITRATE = 1_500_000;

const callGetTurnCredentials = httpsCallable(functions, "getTurnCredentials");
const callStartVideoCall = httpsCallable(functions, "startVideoCall");

const newId = () =>
  (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/-/g, "").slice(0, 20);

async function fetchIceServers(consultationId) {
  try {
    const result = await callGetTurnCredentials({ consultationId });
    return { iceServers: result.data.iceServers };
  } catch (err) {
    console.warn("Couldn't fetch TURN credentials, using STUN only:", err);
    return STUN_ONLY;
  }
}

async function getCamera() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: VIDEO_CONSTRAINTS,
      audio: AUDIO_CONSTRAINTS,
    });
  } catch (err) {
    if (err.name === "OverconstrainedError") {
      return navigator.mediaDevices.getUserMedia({ video: true, audio: AUDIO_CONSTRAINTS });
    }
    throw err;
  }
}

/** Cap the outgoing video bitrate so quality stays steady and CPU sane. */
async function tuneVideoSender(pc) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "video") continue;
    try {
      const params = sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      params.encodings[0].maxBitrate = MAX_VIDEO_BITRATE;
      params.degradationPreference = "balanced";
      await sender.setParameters(params);
    } catch {
      // Not supported everywhere; the browser default is fine.
    }
  }
}

/**
 * status: "connecting" | "waiting" | "connected" | "reconnecting" |
 *         "ending" | "ended" | "error"
 */
export function useWebRTCCall({ consultationId, role, patientSeq, onEnded }) {
  const [status, setStatus] = useState("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMode, setRecordingMode] = useState("video");
  const [recordingWarning, setRecordingWarning] = useState("");

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(new MediaStream());
  const pcRef = useRef(null);
  const recorderRef = useRef(null);
  const recordingStartedRef = useRef(false);
  const endedRef = useRef(false);

  useEffect(() => {
    if (!consultationId) return undefined;
    let cancelled = false;
    const unsubscribers = [];
    let iceConfig = null;

    // Session state
    let mySeq = patientSeq ?? 0; // patient only
    let offeredSeq = -1; // doctor only
    let localSessionId = null; // id of my current offer/answer
    let remoteSessionId = null; // id of the other side's current offer/answer
    let answeredOfferId = null; // patient only
    const pendingCandidates = new Map(); // session -> [candidate]
    let restartTimer = null;
    let wakeLock = null;
    // Snapshots are processed one at a time so offers/answers never interleave.
    let chain = Promise.resolve();
    let lastCall = null;

    function process(call) {
      lastCall = call;
      chain = chain
        .then(() => (role === "doctor" ? onDoctorSnapshot(call) : onPatientSnapshot(call)))
        .catch((err) => console.error("Signalling error:", err));
    }

    const remoteStream = remoteStreamRef.current;

    function setPhase(next) {
      if (!cancelled && !endedRef.current) setStatus(next);
    }

    function closePeer() {
      const pc = pcRef.current;
      pcRef.current = null;
      if (pc) {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.close();
      }
      remoteSessionId = null;
      remoteStream.getTracks().forEach((t) => remoteStream.removeTrack(t));
    }

    function addRemoteCandidate(data) {
      const { session, ...candidate } = data;
      if (!session) return;
      if (session === remoteSessionId && pcRef.current) {
        pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      } else {
        const list = pendingCandidates.get(session) || [];
        if (list.length < 100) list.push(candidate);
        pendingCandidates.set(session, list);
      }
    }

    function flushCandidates(session) {
      const list = pendingCandidates.get(session) || [];
      pendingCandidates.delete(session);
      for (const c of list) pcRef.current?.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }

    async function newPeer(mySide) {
      closePeer();
      if (!iceConfig) iceConfig = await fetchIceServers(consultationId);
      const pc = new RTCPeerConnection(iceConfig);
      pcRef.current = pc;
      localStreamRef.current.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current));

      pc.ontrack = (event) => {
        const track = event.track;
        remoteStream.getTracks()
          .filter((t) => t.kind === track.kind && t.id !== track.id)
          .forEach((t) => remoteStream.removeTrack(t));
        if (!remoteStream.getTrackById(track.id)) remoteStream.addTrack(track);
        const el = remoteVideoRef.current;
        if (el && track.kind === "video") {
          // Re-attach so the element picks up the new track after a reconnect.
          el.srcObject = null;
          el.srcObject = remoteStream;
          el.play?.().catch(() => {});
        }
        recorderRef.current?.syncAudio();
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && localSessionId) {
          addCandidate(consultationId, mySide, event.candidate, localSessionId).catch(() => {});
        }
      };

      pc.onconnectionstatechange = () => {
        if (pcRef.current !== pc || cancelled) return;
        const state = pc.connectionState;
        if (state === "connected") {
          clearTimeout(restartTimer);
          setPhase("connected");
          tuneVideoSender(pc);
          maybeStartRecording();
        } else if (state === "disconnected") {
          setPhase("reconnecting"); // often heals by itself
        } else if (state === "failed") {
          setPhase("reconnecting");
          if (role === "doctor") {
            iceConfig = null; // fresh TURN credentials
            makeOffer(offeredSeq);
          } else {
            schedulePatientRestart(0);
          }
        }
      };
      return pc;
    }

    // ---------------- doctor ----------------
    async function makeOffer(seq) {
      const pc = await newPeer("offerCandidates");
      if (cancelled) return;
      offeredSeq = seq;
      localSessionId = newId();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await writeOffer(consultationId, {
        type: offer.type,
        sdp: offer.sdp,
        id: localSessionId,
        seq,
      });
    }

    async function onDoctorSnapshot(call) {
      if (!call) return; // closed by the server
      const seq = call.patientSeq || 0;
      if (seq !== offeredSeq) {
        // First offer, or the patient (re)joined.
        setPhase(offeredSeq === -1 ? "waiting" : "reconnecting");
        await makeOffer(seq);
        return;
      }
      const answer = call.answer;
      const pc = pcRef.current;
      if (answer && answer.offerId === localSessionId && pc && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription({ type: answer.type, sdp: answer.sdp });
        remoteSessionId = answer.id;
        flushCandidates(answer.id);
      } else if (answer === null && remoteSessionId) {
        // Patient hung up; wait for them to rejoin.
        closePeer();
        setPhase("waiting");
        await makeOffer(seq);
      }
    }

    // ---------------- patient ----------------
    async function answerOffer(offer) {
      answeredOfferId = offer.id;
      const pc = await newPeer("answerCandidates");
      if (cancelled) return;
      await pc.setRemoteDescription({ type: offer.type, sdp: offer.sdp });
      remoteSessionId = offer.id;
      flushCandidates(offer.id);
      localSessionId = newId();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await writeAnswer(consultationId, {
        type: answer.type,
        sdp: answer.sdp,
        id: localSessionId,
        offerId: offer.id,
      });
    }

    function schedulePatientRestart(delay) {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(async () => {
        if (cancelled || pcRef.current?.connectionState === "connected") return;
        try {
          // Re-join: the server bumps patientSeq, the doctor offers again.
          const { data } = await callStartVideoCall({
            consultationId,
            enteredConsultationId: consultationId,
          });
          if (typeof data.patientSeq === "number") {
            mySeq = data.patientSeq;
            // The doctor's new offer may already be here; look again.
            if (lastCall) process(lastCall);
          }
        } catch (err) {
          console.warn("Rejoin failed:", err);
        }
      }, delay);
    }

    async function onPatientSnapshot(call) {
      if (!call) return;
      const offer = call.offer;
      if (!offer) {
        if (pcRef.current) closePeer();
        answeredOfferId = null;
        setPhase("waiting"); // the doctor hasn't joined, or left
        return;
      }
      if (offer.seq === mySeq && offer.id !== answeredOfferId) {
        setPhase(answeredOfferId ? "reconnecting" : "connecting");
        await answerOffer(offer);
        // If this doesn't connect, ask for a fresh offer.
        schedulePatientRestart(PATIENT_RESTART_AFTER_MS);
      }
    }

    // ---------------- recording (doctor) ----------------
    async function maybeStartRecording() {
      if (role !== "doctor" || recordingStartedRef.current || cancelled) return;
      recordingStartedRef.current = true;
      const recorder = createCompositeRecorder({
        consultationId,
        localVideoEl: localVideoRef.current,
        remoteVideoEl: remoteVideoRef.current,
        localStream: localStreamRef.current,
        remoteStream,
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
        console.error("Recording didn't start:", err);
        recorderRef.current = null;
        if (!cancelled) {
          setRecordingWarning(
            "Recording couldn't start. The call can continue; the hospital has been notified.",
          );
        }
      }
    }

    // ---------------- start ----------------
    async function start() {
      try {
        const local = await getCamera();
        if (cancelled) {
          local.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = local;
        if (localVideoRef.current) localVideoRef.current.srcObject = local;
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;

        // Keep the screen on during the call (phones, TVs).
        try {
          wakeLock = await navigator.wakeLock?.request("screen");
        } catch {
          // Not supported / not allowed: harmless.
        }

        const remoteSide = role === "doctor" ? "answerCandidates" : "offerCandidates";
        unsubscribers.push(watchCandidates(consultationId, remoteSide, addRemoteCandidate));

        unsubscribers.push(
          watchCall(
            consultationId,
            (call) => {
              setIsRecording(call?.recordingActive === true);
              setRecordingMode(call?.recordingMode === "audio" ? "audio" : "video");
              process(call);
            },
            () => setIsRecording(false),
          ),
        );
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

    start();

    return () => {
      cancelled = true;
      clearTimeout(restartTimer);
      unsubscribers.forEach((u) => u());
      closePeer();
      wakeLock?.release?.().catch(() => {});
      // On unmount we can't wait; uploads continue while the page is open
      // and the server recovers anything left unfinished.
      recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // patientSeq is read once per call; a re-join remounts the modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId, role]);

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

  function toggleMic() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }

  function toggleCamera() {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraOn(track.enabled);
  }

  // Tell the other side, finish the recording, then tear down.
  async function hangUp() {
    if (endedRef.current) return;
    setStatus("ending");
    const leave = role === "doctor" ? writeOffer(consultationId, null) : writeAnswer(consultationId, null);
    await leave.catch(() => {});
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      await Promise.race([
        recorder.stop().catch(() => {}),
        new Promise((r) => setTimeout(r, FINALIZE_WAIT_MS)),
      ]);
    }
    endedRef.current = true;
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
    recordingMode,
    recordingWarning,
    toggleMic,
    toggleCamera,
    hangUp,
  };
}
