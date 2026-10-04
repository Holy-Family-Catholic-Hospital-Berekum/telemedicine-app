// functions/roomDevices.js
//
//   registerRoomDevice  admin registers the telemedicine room computer
//   revokeRoomDevice    admin withdraws a registered computer
//
// The hospital wants doctors to hold video consultations only from its
// telemedicine room. Instead of reception reading the consultation ID out
// to each doctor, an admin registers the room computer once: the browser
// on that computer keeps a random device key, and startVideoCall accepts a
// doctor only when the call carries an active key (verifyRoomDevice). The
// server stores just a SHA-256 of the key, so the roomDevices documents
// can't be used to start calls. A lost or replaced computer is revoked
// here. Every step is audited.

const crypto = require("crypto");
const {
  onCall,
  db,
  serverTime,
  HttpsError,
  requireRole,
  requestMeta,
  str,
  docId,
  sha256,
  audit,
  rateLimit,
} = require("./lib/core");

const KEY_RE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

/** data: { label } -> { deviceId, key } (the key is shown only this once) */
exports.registerRoomDevice = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const label = str(request.data?.label, { field: "Name", max: 60, min: 2 });
  await rateLimit(caller.uid, "registerRoomDevice", { max: 10, windowSeconds: 86400 });

  const key = crypto.randomBytes(32).toString("base64url");
  const ref = db.collection("roomDevices").doc();
  const batch = db.batch();
  batch.set(ref, {
    label,
    keyHash: sha256(key),
    status: "active",
    createdByUid: caller.uid,
    createdAt: serverTime(),
    lastUsedAt: null,
  });
  audit(batch, {
    actorId: caller.uid,
    actorRole: "admin",
    action: "Registered a telemedicine room computer",
    code: "room_device.registered",
    category: "security",
    targetType: "room_device",
    targetId: ref.id,
    meta: requestMeta(request),
  });
  await batch.commit();
  return { deviceId: ref.id, key };
});

/** data: { deviceId } */
exports.revokeRoomDevice = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const deviceId = docId(request.data?.deviceId, "Device");
  const ref = db.collection("roomDevices").doc(deviceId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Device not found.");
    if (snap.data().status !== "active") return;
    tx.update(ref, { status: "revoked", revokedByUid: caller.uid, revokedAt: serverTime() });
    audit(tx, {
      actorId: caller.uid,
      actorRole: "admin",
      action: "Removed a telemedicine room computer",
      code: "room_device.revoked",
      category: "security",
      targetType: "room_device",
      targetId: deviceId,
      meta: requestMeta(request),
    });
  });
  return { ok: true };
});

/**
 * Throws unless `device` ({ id, key }) is an active registered room
 * computer. Returns the device's document reference.
 */
async function verifyRoomDevice(device) {
  const refuse = () => {
    throw new HttpsError(
      "permission-denied",
      "Video consultations can only be started from the hospital's telemedicine room computer.",
      { reason: "room_device_required" },
    );
  };
  const id = typeof device?.id === "string" ? device.id : "";
  const key = typeof device?.key === "string" ? device.key : "";
  if (!/^[A-Za-z0-9]{1,40}$/.test(id) || !KEY_RE.test(key)) refuse();

  const ref = db.collection("roomDevices").doc(id);
  const snap = await ref.get();
  const d = snap.exists ? snap.data() : null;
  if (!d || d.status !== "active" || typeof d.keyHash !== "string") refuse();
  const given = Buffer.from(sha256(key), "hex");
  const stored = Buffer.from(d.keyHash, "hex");
  if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) refuse();
  return ref;
}

exports.verifyRoomDevice = verifyRoomDevice;
