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
// ICE candidates. The server removes the whole thing when the consultation
// closes, when the doctor rejoins (fresh start), or after 6 hours.
import { db } from "../../src/firebase";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  onSnapshot,
} from "firebase/firestore";

function callDocRef(consultationId) {
  return doc(db, "calls", consultationId);
}

function candidatesCollection(consultationId, side) {
  // "offerCandidates" (doctor) or "answerCandidates" (patient)
  return collection(db, "calls", consultationId, side);
}

/**
 * Doctor side: the doctor is always the WebRTC offerer. startVideoCall must
 * have run first (it resets the call document for a clean start).
 * Returns an unsubscribe function.
 */
export async function createOffer(consultationId, peerConnection, onAnswer) {
  const callDoc = callDocRef(consultationId);

  const unsubscribeIceGathering = watchLocalIceCandidates(
    peerConnection,
    candidatesCollection(consultationId, "offerCandidates"),
  );

  const offerDescription = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offerDescription);
  await updateDoc(callDoc, {
    offer: { sdp: offerDescription.sdp, type: offerDescription.type },
  });

  const unsubscribeAnswer = onSnapshot(callDoc, (snapshot) => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data?.answer) {
      peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      onAnswer?.();
    }
  });

  const unsubscribeRemoteIce = watchRemoteIceCandidates(
    peerConnection,
    candidatesCollection(consultationId, "answerCandidates"),
  );

  return () => {
    unsubscribeIceGathering();
    unsubscribeAnswer();
    unsubscribeRemoteIce();
  };
}

/**
 * Patient side: waits briefly for the doctor's offer, then answers it.
 * Returns an unsubscribe function.
 */
export async function joinCall(consultationId, peerConnection) {
  const callDoc = callDocRef(consultationId);
  const callSnapshot = await waitForOffer(callDoc);

  await peerConnection.setRemoteDescription(
    new RTCSessionDescription(callSnapshot.data().offer),
  );
  const answerDescription = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answerDescription);

  const unsubscribeIceGathering = watchLocalIceCandidates(
    peerConnection,
    candidatesCollection(consultationId, "answerCandidates"),
  );
  await updateDoc(callDoc, {
    answer: { type: answerDescription.type, sdp: answerDescription.sdp },
  });

  const unsubscribeRemoteIce = watchRemoteIceCandidates(
    peerConnection,
    candidatesCollection(consultationId, "offerCandidates"),
  );

  return () => {
    unsubscribeIceGathering();
    unsubscribeRemoteIce();
  };
}

/**
 * Follows the server-set `recordingActive` flag so BOTH participants see
 * the REC indicator. Returns an unsubscribe function.
 */
export function watchRecordingState(consultationId, onChange) {
  return onSnapshot(
    callDocRef(consultationId),
    (snapshot) => onChange(snapshot.data()?.recordingActive === true),
    () => onChange(false),
  );
}

function waitForOffer(callDoc, attempt = 0) {
  return new Promise((resolve, reject) => {
    getDoc(callDoc)
      .then((snapshot) => {
        if (snapshot.exists() && snapshot.data()?.offer) {
          resolve(snapshot);
        } else if (attempt > 40) {
          // ~20 seconds: the doctor almost certainly hasn't started yet.
          reject(new Error("The doctor hasn't started the call yet. Please try again in a moment."));
        } else {
          setTimeout(
            () => waitForOffer(callDoc, attempt + 1).then(resolve, reject),
            500,
          );
        }
      })
      .catch(reject);
  });
}

function watchLocalIceCandidates(peerConnection, candidatesCollectionRef) {
  function handleIceCandidate(event) {
    if (event.candidate) {
      addDoc(candidatesCollectionRef, event.candidate.toJSON()).catch(() => {
        // A rejected candidate only narrows the connection options.
      });
    }
  }
  peerConnection.addEventListener("icecandidate", handleIceCandidate);
  return () =>
    peerConnection.removeEventListener("icecandidate", handleIceCandidate);
}

function watchRemoteIceCandidates(peerConnection, candidatesCollectionRef) {
  return onSnapshot(candidatesCollectionRef, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        peerConnection
          .addIceCandidate(new RTCIceCandidate(change.doc.data()))
          .catch(() => {
            // Benign if it arrives after the connection already closed.
          });
      }
    });
  });
}
