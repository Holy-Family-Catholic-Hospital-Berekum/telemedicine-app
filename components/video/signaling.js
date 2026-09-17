// signaling.js
//
// The only file useWebRTCCall.js imports signaling from. Everything
// else (createOffer / joinCall / teardownCallSignaling) is identical
// between the two backends below — this file just decides which one is
// active.
//
// RIGHT NOW: mock backend (local WebSocket relay), because Firebase
// isn't connected yet. Good for UX/flow testing on your own network.
//
// WHEN FIREBASE IS READY: comment out the mock line, uncomment the
// firebase line below, fix the db import path inside signaling.firebase.js,
// and add the Firestore security rules mentioned in that file's
// comments. Nothing in useWebRTCCall.js, VideoCallModal.jsx, or either
// dashboard needs to change.

export * from "./signaling.mock";
// export * from "./signaling.firebase";
