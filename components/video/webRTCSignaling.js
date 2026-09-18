// webrtcSignaling.js
//
// Signaling for a 1:1 WebRTC call, using Firestore as the message bus
// between the two browsers (this is the standard pattern from Google's
// own WebRTC codelab, adapted to fit your existing Firestore project —
// no extra signaling server to run).
//
// One document per call, keyed by consultationId, holding the SDP
// offer/answer, plus two subcollections for ICE candidates trickling in
// from each side.
//
// ASSUMPTION: adjust this import to wherever your Firestore instance is
// initialized (the file that calls initializeApp / getFirestore).
// docFirestoreService.js / patientFirestoreService.js presumably already
// import it from somewhere similar.
import { db } from "../../src/firebase";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

function callDocRef(consultationId) {
  return doc(db, "calls", consultationId);
}

function candidatesCollection(consultationId, side) {
  // side is "offerCandidates" (doctor's ICE candidates) or
  // "answerCandidates" (patient's ICE candidates)
  return collection(db, "calls", consultationId, side);
}

/**
 * Doctor side. Call is always initiated by the doctor (they click
 * "Start call" first in your existing flow, before the patient joins),
 * so the doctor is always the WebRTC "offerer".
 *
 * Returns an unsubscribe function — call it when the doctor hangs up or
 * the component unmounts.
 */
export async function createOffer(consultationId, peerConnection, onAnswer) {
  const callDoc = callDocRef(consultationId);
  const offerCandidates = candidatesCollection(consultationId, "offerCandidates");

  // Collect this side's ICE candidates as they trickle in and publish
  // each one as its own document so the other side can pick them up.
  const unsubscribeIceGathering = watchLocalIceCandidates(
    peerConnection,
    offerCandidates,
  );

  const offerDescription = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offerDescription);

  await setDoc(callDoc, {
    offer: {
      sdp: offerDescription.sdp,
      type: offerDescription.type,
    },
    createdAt: serverTimestamp(),
  });

  // Watch for the patient's answer.
  const unsubscribeAnswer = onSnapshot(callDoc, (snapshot) => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      peerConnection.setRemoteDescription(answerDescription);
      onAnswer?.();
    }
  });

  // Watch for the patient's ICE candidates.
  const answerCandidates = candidatesCollection(consultationId, "answerCandidates");
  const unsubscribeRemoteIce = watchRemoteIceCandidates(
    peerConnection,
    answerCandidates,
  );

  return () => {
    unsubscribeIceGathering();
    unsubscribeAnswer();
    unsubscribeRemoteIce();
  };
}

/**
 * Patient side. Waits for the doctor's offer (retrying briefly if the
 * patient's app loaded a moment before the doctor's "Start call" write
 * landed), then answers it.
 */
export async function joinCall(consultationId, peerConnection) {
  const callDoc = callDocRef(consultationId);
  const callSnapshot = await waitForOffer(callDoc);
  const offerDescription = callSnapshot.data().offer;

  await peerConnection.setRemoteDescription(
    new RTCSessionDescription(offerDescription),
  );

  const answerDescription = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answerDescription);

  await updateDoc(callDoc, {
    answer: {
      type: answerDescription.type,
      sdp: answerDescription.sdp,
    },
  });

  const answerCandidates = candidatesCollection(consultationId, "answerCandidates");
  const unsubscribeIceGathering = watchLocalIceCandidates(
    peerConnection,
    answerCandidates,
  );

  const offerCandidates = candidatesCollection(consultationId, "offerCandidates");
  const unsubscribeRemoteIce = watchRemoteIceCandidates(
    peerConnection,
    offerCandidates,
  );

  return () => {
    unsubscribeIceGathering();
    unsubscribeRemoteIce();
  };
}

function waitForOffer(callDoc, attempt = 0) {
  return new Promise((resolve, reject) => {
    getDoc(callDoc).then((snapshot) => {
      if (snapshot.exists() && snapshot.data()?.offer) {
        resolve(snapshot);
      } else if (attempt > 20) {
        // ~10 seconds of retrying — after that, the doctor almost
        // certainly hasn't clicked "Start call" yet.
        reject(new Error("The doctor hasn't started the call yet."));
      } else {
        setTimeout(
          () => waitForOffer(callDoc, attempt + 1).then(resolve, reject),
          500,
        );
      }
    });
  });
}

function watchLocalIceCandidates(peerConnection, candidatesCollectionRef) {
  function handleIceCandidate(event) {
    if (event.candidate) {
      addDoc(candidatesCollectionRef, event.candidate.toJSON());
    }
  }
  peerConnection.addEventListener("icecandidate", handleIceCandidate);
  return () =>
    peerConnection.removeEventListener("icecandidate", handleIceCandidate);
}

function watchRemoteIceCandidates(peerConnection, candidatesCollectionRef) {
  const unsubscribe = onSnapshot(candidatesCollectionRef, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const candidate = new RTCIceCandidate(change.doc.data());
        peerConnection.addIceCandidate(candidate).catch(() => {
          // Benign if it arrives after the connection already closed.
        });
      }
    });
  });
  return unsubscribe;
}

/**
 * Cleans up the call document and its candidate subcollections. Call
 * this once, from whichever side hangs up last (or both — it's safe to
 * call twice), so stale signaling data doesn't pile up in Firestore.
 * This is separate from and in addition to the section-4.6 erasure of
 * booking/consultation documents — this only removes WebRTC plumbing.
 */
export async function teardownCallSignaling(consultationId) {
  await deleteDoc(callDocRef(consultationId)).catch(() => {});
}