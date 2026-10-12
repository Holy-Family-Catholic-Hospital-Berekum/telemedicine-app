// src/authSdkLoader.js
//
// Firebase (Auth, Firestore, Functions) is loaded on demand, right after the
// page first appears, so public pages never wait for it (it's a third of a
// phone's first download). Every authContext function that needs it waits
// for it first; `initializing` stays true until the sign-in state is known.
//
// One shared promise, so the Firebase chunk is fetched once however many
// places ask for it.

let authSdkPromise = null;
export function loadAuthSdk() {
  if (!authSdkPromise) {
    authSdkPromise = import("./authSdk.js").catch((err) => {
      authSdkPromise = null; // e.g. offline: try again next time
      throw new Error("We couldn't connect. Check your internet connection and try again.", { cause: err });
    });
  }
  return authSdkPromise;
}
