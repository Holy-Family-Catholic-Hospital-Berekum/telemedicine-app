// signaling.firebase.js
//
// WebRTC signalling over Firestore. Firestore only carries the SDP
// offer/answer and ICE candidates; once connected, video and audio flow
// directly between the two browsers (DTLS-SRTP), or through the TURN relay,
// which can't decrypt them.
//
// calls/{consultationId} is created by the startVideoCall Cloud Function
// with the doctor's and patient's UIDs; clients can't create or delete it.
// Security Rules let only those two people read it, the doctor write only
// `offer`, the patient write only `answer`, and each side add only its own
// ICE candidates. See useWebRTCCall.js for the protocol (offer ids, seq).
import { db } from "../../src/firebase";
import { doc, updateDoc, collection, addDoc, onSnapshot } from "firebase/firestore";

const callRef = (consultationId) => doc(db, "calls", consultationId);
// "offerCandidates" (doctor) or "answerCandidates" (patient)
const candidatesRef = (consultationId, side) => collection(db, "calls", consultationId, side);

/** Calls onChange(data | null) on every change of the call document. */
export function watchCall(consultationId, onChange, onError) {
  return onSnapshot(
    callRef(consultationId),
    (snap) => onChange(snap.exists() ? snap.data() : null),
    (err) => onError?.(err),
  );
}

/** Doctor: { type, sdp, id, seq }, or null to say "I left". */
export function writeOffer(consultationId, offer) {
  return updateDoc(callRef(consultationId), { offer });
}

/** Patient: { type, sdp, id, offerId }, or null to say "I left". */
export function writeAnswer(consultationId, answer) {
  return updateDoc(callRef(consultationId), { answer });
}

/** Adds one local ICE candidate, tagged with the offer/answer id it belongs to. */
export function addCandidate(consultationId, side, candidate, session) {
  return addDoc(candidatesRef(consultationId, side), { ...candidate.toJSON(), session });
}

/** Calls onCandidate(data) for each candidate the other side adds. */
export function watchCandidates(consultationId, side, onCandidate) {
  return onSnapshot(candidatesRef(consultationId, side), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "added") onCandidate(change.doc.data());
    });
  });
}
