// The video room opens 30 minutes before the scheduled time. This is a
// display rule; startVideoCall enforces the same window on the server.
import { CALL_UNLOCK_MINUTES } from "../../src/constants";

const UNLOCK_WINDOW_MS = CALL_UNLOCK_MINUTES * 60 * 1000;

export function getCallWindow(scheduledTime, now = new Date()) {
  const scheduledMs = new Date(scheduledTime).getTime();
  const unlockAtMs = scheduledMs - UNLOCK_WINDOW_MS;
  const nowMs = now.getTime();
  const unlocked = nowMs >= unlockAtMs;
  const minutesUntilUnlock = unlocked
    ? 0
    : Math.ceil((unlockAtMs - nowMs) / 60000);
  return { unlocked, minutesUntilUnlock };
}

// ---------------------------------------------------------------------------
// Doctor profile photo helpers (new)
// ---------------------------------------------------------------------------

export const MAX_PROFILE_PHOTO_MB = 5;
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Client-side check only. Storage Rules must enforce the same limits
// server-side (see uploadDoctorProfilePicture in firestoreService.js) —
// this is a fast, friendly first check, not the security boundary.
export function validateProfilePhoto(file) {
  if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
    return "Please choose a JPG, PNG, or WEBP image.";
  }
  if (file.size > MAX_PROFILE_PHOTO_MB * 1024 * 1024) {
    return `Please choose an image under ${MAX_PROFILE_PHOTO_MB}MB.`;
  }
  return null;
}

// Downscales and re-encodes the photo in the browser before it ever reaches
// Storage. The landing page's "Meet your doctors" grid only ever shows this
// at thumbnail size, so there's no reason to pay to store or serve a
// full-resolution original — keeps both Storage usage and the public page's
// load time small, in line with the project's zero/low-cost goal.
export function resizeProfilePhoto(file, maxDimension = 480) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          if (blob) resolve(blob);
          else reject(new Error("Could not process that image."));
        },
        "image/jpeg",
        0.85,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image."));
    };

    img.src = objectUrl;
  });
}
