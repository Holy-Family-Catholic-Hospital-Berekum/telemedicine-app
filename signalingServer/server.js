// server.js
//
// A minimal signaling relay: clients "join" a room (named after the
// consultationId) and anything one client sends gets forwarded to
// everyone else in that same room. That's the entire job — it never
// looks at or stores the SDP/ICE payloads it relays.
//
// FOR LOCAL TESTING ONLY. This has no auth, no TLS, and isn't meant to
// run anywhere but your own dev machine / LAN while Firebase isn't wired
// up yet. Once Firebase is connected, this whole folder goes away —
// switch signaling.js back to signaling.firebase.js instead.
//
// Setup:
//   npm install ws
//   node server.js
//
// It listens on 0.0.0.0 (not just localhost) so your phone can reach it
// too, as long as the phone is on the same wifi network as this
// machine and you've pointed signaling.mock.js at this machine's LAN IP
// (see the TODO comment in that file).

import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 4000;
const wss = new WebSocketServer({ port: PORT, host: "0.0.0.0" });

// consultationId -> Set of connected sockets in that room
const rooms = new Map();

wss.on("connection", (socket) => {
  let currentRoom = null;

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return; // ignore anything that isn't valid JSON
    }

    if (message.type === "join") {
      currentRoom = message.room;
      if (!rooms.has(currentRoom)) rooms.set(currentRoom, new Set());
      rooms.get(currentRoom).add(socket);
      console.log(`Client joined room "${currentRoom}" (${rooms.get(currentRoom).size} in room)`);
      return;
    }

    if (!currentRoom) return; // ignore messages before a join
    const peers = rooms.get(currentRoom);
    if (!peers) return;

    for (const peer of peers) {
      if (peer !== socket && peer.readyState === peer.OPEN) {
        peer.send(raw.toString());
      }
    }
  });

  socket.on("close", () => {
    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).delete(socket);
      if (rooms.get(currentRoom).size === 0) rooms.delete(currentRoom);
    }
  });
});

console.log(`Signaling relay listening on ws://0.0.0.0:${PORT}`);
console.log(`On your phone/other device, use ws://<this-machine's-LAN-IP>:${PORT}`);
