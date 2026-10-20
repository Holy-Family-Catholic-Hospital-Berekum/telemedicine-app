// functions/lib/signInAlerts.js
//
// "New sign-in to your account" emails, so a stolen password is noticed.
// Each browser keeps a random device id (src/deviceId.js). The account
// keeps hashes of the ones it has signed in from (`knownDevices` on
// users/{uid} or adminUsers/{uid}: hash -> last seen). A sign-in from a
// browser not on that list emails the account holder.
//
// The first browser an account is seen on is recorded without an email
// (a new account, or one from before this existed). Clearing a browser's
// site data makes it "new" again: the email says to ignore it if it was them.
//
// Called by accounts.js noteSignIn (patients, from the browser right after
// signing in) and staffAuth.js confirmStaffSession (staff, on a fresh
// sign-in; the portals can't be used without it).

const { db, Timestamp, sha256, rateLimit } = require("./core");
const { queueEmail } = require("./mailQueue");

const MAX_KNOWN_DEVICES = 10;
// At most this many alert emails per account per day (a sign-in loop can't
// flood someone's inbox).
const MAX_ALERTS_PER_DAY = 5;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** True for a device id the browser could have made (src/deviceId.js). */
function validDeviceId(id) {
  return typeof id === "string" && DEVICE_ID_RE.test(id);
}

/** "Chrome on Android", from a user-agent string; a rough guide only. */
function describeDevice(userAgent) {
  const ua = String(userAgent || "");
  const browser =
    /SamsungBrowser/i.test(ua) ? "Samsung Internet"
      : /Edg(e|A|iOS)?\//i.test(ua) ? "Edge"
        : /OPR\/|Opera/i.test(ua) ? "Opera"
          : /Firefox\/|FxiOS/i.test(ua) ? "Firefox"
            : /Chrome\/|CriOS/i.test(ua) ? "Chrome"
              : /Safari\//i.test(ua) ? "Safari"
                : null;
  const system =
    /iPhone/i.test(ua) ? "iPhone"
      : /iPad/i.test(ua) ? "iPad"
        : /Android/i.test(ua) ? "Android"
          : /Windows/i.test(ua) ? "Windows"
            : /Mac OS X|Macintosh/i.test(ua) ? "Mac"
              : /CrOS/i.test(ua) ? "Chromebook"
                : /Linux/i.test(ua) ? "Linux"
                  : null;
  if (browser && system) return `${browser} on ${system}`;
  return browser || system || "An unknown device";
}

/**
 * Records this sign-in's browser on the account and emails the holder if
 * it's one they haven't used before.
 * ref: users/{uid} or adminUsers/{uid}. audience: "patient" | "staff".
 * Returns { isNew, alerted }.
 */
async function noteDevice({ ref, uid, deviceId, userAgent, audience }) {
  if (!validDeviceId(deviceId)) return { isNew: false, alerted: false };
  const key = sha256(`${uid}:${deviceId}`).slice(0, 32);
  const now = Date.now();

  const seen = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data();
    const known = data.knownDevices && typeof data.knownDevices === "object" ? data.knownDevices : null;
    const isNew = !known || !Object.hasOwn(known, key);
    // Most recently used first; keep the newest few.
    const kept = Object.entries(known || {})
      .filter(([k]) => k !== key)
      .sort(([, a], [, b]) => (b?.toMillis?.() ?? 0) - (a?.toMillis?.() ?? 0))
      .slice(0, MAX_KNOWN_DEVICES - 1);
    tx.update(ref, {
      knownDevices: Object.fromEntries([[key, Timestamp.fromMillis(now)], ...kept]),
    });
    return { isNew, first: !known || Object.keys(known).length === 0, email: data.email, name: data.name };
  });

  if (!seen?.isNew || seen.first || !seen.email) return { isNew: Boolean(seen?.isNew), alerted: false };

  try {
    await rateLimit(uid, "signInAlert", { max: MAX_ALERTS_PER_DAY, windowSeconds: 86400 });
  } catch {
    return { isNew: true, alerted: false };
  }
  const batch = db.batch();
  queueEmail(batch, {
    to: seen.email,
    kind: "security_new_sign_in",
    data: { scheduledAt: now, name: seen.name || "", device: describeDevice(userAgent), audience },
    sendBefore: now + 24 * 3600 * 1000,
    deleteAfterMs: 7 * 86400 * 1000,
  });
  await batch.commit();
  return { isNew: true, alerted: true };
}

module.exports = { noteDevice, describeDevice, validDeviceId };
