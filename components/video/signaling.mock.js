// signaling.mock.js
//
// ACTIVE (for now). Same job as signaling.firebase.js — exchange the
// SDP offer/answer and ICE candidates between the doctor and patient
// browsers — but over a plain WebSocket to the small local relay in
// /signaling-server, instead of Firestore. This is purely a stand-in
// for testing/UX work before Firebase is connected.
//
// Exports the exact same three functions as signaling.firebase.js
// (createOffer, joinCall, teardownCallSignaling), with the same
// signatures. useWebRTCCall.js only ever imports from signaling.js, so
// once Firebase is ready, flip the one export line in signaling.js and
// delete this file — nothing else changes.

// TODO(transition): point this at your machine's LAN IP, not
// "localhost" — that's what lets your phone reach it too, the same way
// you're already reaching the Vite dev server from your phone.
// Find it with `ipconfig` (Windows) or `ifconfig` / `ip addr` (Mac/
// Linux) — it looks like 192.168.x.x. Leave the port matching whatever
// PORT the relay server is started with (see signaling-server/server.js).
const SIGNALING_SERVER_URL = "ws://192.168.1.137:4000";

function connectToRoom(consultationId) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(SIGNALING_SERVER_URL);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "join", room: consultationId }));
      resolve(socket);
    });

    socket.addEventListener("error", () => {
      reject(
        new Error(
          "Couldn't reach the signaling server. Is signaling-server/server.js running, " +
            "and is SIGNALING_SERVER_URL in signaling.mock.js set to your PC's LAN IP?",
        ),
      );
    });
  });
}

// ICE candidates can arrive (over the wire) before the local/remote
// SDP description they depend on is set, which makes addIceCandidate
// throw. This just holds them until it's safe to apply them — same
// safeguard the Firestore version gets "for free" from onSnapshot
// firing in order, but a raw WebSocket needs it explicit.
function makeIceCandidateBuffer(peerConnection) {
  const pending = [];
  return {
    add(candidateInit) {
      if (peerConnection.remoteDescription) {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidateInit)).catch(() => {});
      } else {
        pending.push(candidateInit);
      }
    },
    flush() {
      while (pending.length) {
        const candidateInit = pending.shift();
        peerConnection.addIceCandidate(new RTCIceCandidate(candidateInit)).catch(() => {});
      }
    },
  };
}

export async function createOffer(consultationId, peerConnection, onAnswer) {
  const socket = await connectToRoom(consultationId);
  const remoteCandidates = makeIceCandidateBuffer(peerConnection);

  function handleLocalIceCandidate(event) {
    if (event.candidate) {
      socket.send(JSON.stringify({ type: "ice", candidate: event.candidate.toJSON() }));
    }
  }
  peerConnection.addEventListener("icecandidate", handleLocalIceCandidate);

  async function handleMessage(event) {
    const message = JSON.parse(event.data);
    if (message.type === "answer" && !peerConnection.currentRemoteDescription) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));
      remoteCandidates.flush();
      onAnswer?.();
    } else if (message.type === "ice") {
      remoteCandidates.add(message.candidate);
    }
  }
  socket.addEventListener("message", handleMessage);

  const offerDescription = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offerDescription);
  socket.send(JSON.stringify({ type: "offer", sdp: offerDescription }));

  return () => {
    peerConnection.removeEventListener("icecandidate", handleLocalIceCandidate);
    socket.removeEventListener("message", handleMessage);
    socket.close();
  };
}

export async function joinCall(consultationId, peerConnection) {
  const socket = await connectToRoom(consultationId);
  const remoteCandidates = makeIceCandidateBuffer(peerConnection);

  function handleLocalIceCandidate(event) {
    if (event.candidate) {
      socket.send(JSON.stringify({ type: "ice", candidate: event.candidate.toJSON() }));
    }
  }
  peerConnection.addEventListener("icecandidate", handleLocalIceCandidate);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("The doctor hasn't started the call yet."));
    }, 15000);

    async function handleMessage(event) {
      const message = JSON.parse(event.data);
      if (message.type === "offer") {
        clearTimeout(timeout);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.sdp));
        remoteCandidates.flush();
        const answerDescription = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answerDescription);
        socket.send(JSON.stringify({ type: "answer", sdp: answerDescription }));
        resolve();
      } else if (message.type === "ice") {
        remoteCandidates.add(message.candidate);
      }
    }
    socket.addEventListener("message", handleMessage);
  });

  return () => {
    peerConnection.removeEventListener("icecandidate", handleLocalIceCandidate);
    socket.close();
  };
}

export async function teardownCallSignaling() {
  // No shared document to clean up for the mock backend — each side's
  // unsubscribe function (returned above) already closes its socket.
  // Kept as a no-op async function so it matches signaling.firebase.js's
  // shape exactly.
}
