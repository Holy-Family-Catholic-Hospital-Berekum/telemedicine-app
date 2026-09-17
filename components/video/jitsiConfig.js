// jitsiConfig.js
//
// Shared config for the Jitsi Meet integration. Everything here is plain
// config/helpers — no React — so it can be imported from both the doctor
// and patient sides.

// Jitsi's free public server. No account, no server to run, no extra
// npm package needed — we load their "External API" script at runtime.
// If Holy Family later self-hosts Jitsi (e.g. for stricter data-handling
// requirements), this is the only line that needs to change.
export const JITSI_DOMAIN = "meet.jit.si";

// A short, fixed namespace so this hospital's rooms don't collide with
// the millions of other rooms on the public meet.jit.si server. This is
// NOT a secret — the architecture doc's actual guarantee against
// guessing comes from the consultation ID itself being generated
// server-side and being hard to guess (see 4.4 / 4.5 of the
// architecture doc). This prefix just namespaces it.
const ROOM_PREFIX = "hfch-telemed";

/**
 * Builds the Jitsi room name for a given consultation.
 * Both the doctor app and the patient app must call this with the same
 * consultationId to land in the same room.
 */
export function buildJitsiRoomName(consultationId) {
  if (!consultationId) {
    throw new Error("buildJitsiRoomName: consultationId is required");
  }
  // Strip anything that isn't alphanumeric/dash so the room name is
  // always a clean, valid Jitsi room slug regardless of what the
  // consultation ID looks like.
  const safeId = String(consultationId).replace(/[^a-zA-Z0-9-]/g, "");
  return `${ROOM_PREFIX}-${safeId}`;
}

/**
 * Jitsi "configOverwrite" - behavior of the call itself.
 * Recording is intentionally left disabled (see 4.5: "No call recording
 * is enabled").
 */
export function buildJitsiConfigOverwrite() {
  return {
    prejoinPageEnabled: false, // skip Jitsi's own lobby/preview screen
    disableDeepLinking: true, // don't prompt to open the native Jitsi app
    startWithAudioMuted: false,
    startWithVideoMuted: false,
    enableWelcomePage: false,
    disableInviteFunctions: true, // no "invite someone" inside the call
    hideConferenceSubject: true,
    hideConferenceTimer: false,
    disableRecordAudioAndVideo: true, // extra guard on top of removing the button below
    fileRecordingsEnabled: false,
    liveStreamingEnabled: false,
  };
}

/**
 * Jitsi "interfaceConfigOverwrite" - which buttons/UI show up.
 * Recording, live-streaming, and dial-in are stripped from the toolbar
 * entirely so there's no button to even try.
 */
export function buildJitsiInterfaceConfigOverwrite() {
  return {
    TOOLBAR_BUTTONS: [
      "microphone",
      "camera",
      "closedcaptions",
      "desktop",
      "fullscreen",
      "fodeviceselection",
      "hangup",
      "chat",
      "settings",
      "raisehand",
      "tileview",
    ],
    SHOW_JITSI_WATERMARK: false,
    SHOW_WATERMARK_FOR_GUESTS: false,
    MOBILE_APP_PROMO: false,
    HIDE_INVITE_MORE_HEADER: true,
  };
}
