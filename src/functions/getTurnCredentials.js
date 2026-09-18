// functions/getTurnCredentials.js
//
// A Cloud Function that hands the browser short-lived TURN credentials,
// so the real secret (CLOUDFLARE_TURN_API_TOKEN) never has to leave
// your backend. Add this to your functions folder and export it from
// functions/index.js, e.g.:
//
//   const { getTurnCredentials } = require("./getTurnCredentials");
//   exports.getTurnCredentials = getTurnCredentials;
//
// (Written for Firebase Functions v2 / Node 18+. If your project is on
// v1 functions, say so and I'll adjust the export style.)

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const CLOUDFLARE_TURN_KEY_ID = defineSecret("CLOUDFLARE_TURN_KEY_ID");
const CLOUDFLARE_TURN_API_TOKEN = defineSecret("CLOUDFLARE_TURN_API_TOKEN");

exports.getTurnCredentials = onCall(
  { secrets: [CLOUDFLARE_TURN_KEY_ID, CLOUDFLARE_TURN_API_TOKEN] },
  async (request) => {
    // Require the caller to be signed in — matches the rest of the
    // app's Firebase Auth setup. Without this, anyone could hit this
    // function directly and mint themselves free TURN credentials,
    // quietly burning through your Cloudflare free tier.
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign-in required.");
    }

    const keyId = CLOUDFLARE_TURN_KEY_ID.value();
    const apiToken = CLOUDFLARE_TURN_API_TOKEN.value();

    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        // 1 hour is comfortably longer than a single consultation;
        // short-lived credentials limit how long a leaked credential
        // (e.g. from a browser's dev tools) would even work for.
        body: JSON.stringify({ ttl: 3600 }),
      },
    );

    if (!response.ok) {
      throw new HttpsError("internal", "Couldn't get TURN credentials from Cloudflare.");
    }

    const data = await response.json();
    return { iceServers: data.iceServers };
  },
);
