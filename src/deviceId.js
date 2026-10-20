// deviceId.js
//
// A random id for this browser, kept in localStorage (it survives
// sign-out). Sent when someone signs in so the server can tell a browser
// the account has used before from a new one, and email the account holder
// about a sign-in from a new device (functions/lib/signInAlerts.js).
// It identifies nothing about the person or the device itself.

const STORAGE_KEY = "hfch.deviceId";

/** This browser's id, made on first use; null if storage is blocked. */
export function getDeviceId() {
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      const bytes = crypto.getRandomValues(new Uint8Array(18));
      id = btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}
