// roomDevice.js
//
// The telemedicine room computer's device key. An admin registers the room
// computer once (Control panel > Telemedicine room computers); the key is
// kept in this browser's localStorage, which survives sign-out, so any
// doctor who signs in on that computer can start their calls with one
// click. startVideoCall refuses doctors whose browser has no active key
// (functions/roomDevices.js). Clearing site data on the computer removes
// the key: register it again.

const STORAGE_KEY = "hfch.roomDevice";

/** { id, key, label } or null */
export function getRoomDevice() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const d = raw ? JSON.parse(raw) : null;
    return d && typeof d.id === "string" && typeof d.key === "string" ? d : null;
  } catch {
    return null;
  }
}

export function saveRoomDevice(device) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(device));
    return true;
  } catch {
    return false;
  }
}

export function forgetRoomDevice() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing stored
  }
}
