import { useEffect, useRef, useState } from "react";
import {
  JITSI_DOMAIN,
  buildJitsiConfigOverwrite,
  buildJitsiInterfaceConfigOverwrite,
} from "./jitsiConfig";

// Loads Jitsi's "external_api.js" exactly once, no matter how many times
// this component mounts across the app.
let jitsiScriptPromise = null;
function loadJitsiScript() {
  if (window.JitsiMeetExternalAPI) return Promise.resolve();
  if (jitsiScriptPromise) return jitsiScriptPromise;

  jitsiScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://${JITSI_DOMAIN}/external_api.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Could not load the Jitsi Meet script."));
    document.body.appendChild(script);
  });

  return jitsiScriptPromise;
}

/**
 * JitsiRoom
 *
 * Embeds a Jitsi Meet call inside the app. Doesn't know anything about
 * "doctor" vs "patient" — it just joins whatever roomName it's given
 * with the given displayName.
 *
 * Props:
 * - roomName: string (required) - from buildJitsiRoomName(consultationId)
 * - displayName: string (required) - shown to the other participant
 * - onCallEnded: () => void - fired when the local user hangs up or the
 *   call ends for any reason
 * - onParticipantJoined / onParticipantLeft: optional callbacks
 */
export default function JitsiRoom({
  roomName,
  displayName,
  onCallEnded,
  onParticipantJoined,
  onParticipantLeft,
}) {
  const containerRef = useRef(null);
  const apiRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    loadJitsiScript()
      .then(() => {
        if (cancelled || !containerRef.current) return;

        const api = new window.JitsiMeetExternalAPI(JITSI_DOMAIN, {
          roomName,
          parentNode: containerRef.current,
          width: "100%",
          height: "100%",
          userInfo: { displayName },
          configOverwrite: buildJitsiConfigOverwrite(),
          interfaceConfigOverwrite: buildJitsiInterfaceConfigOverwrite(),
        });

        apiRef.current = api;

        // The iframe (including Jitsi's own "enter your name / Join
        // meeting" prejoin screen) exists as soon as the API is
        // constructed — that's the point to stop covering it with our
        // own overlay, not videoConferenceJoined (which only fires
        // *after* the user has already clicked Join, so waiting for it
        // left the overlay sitting on top, blocking every click).
        if (!cancelled) setStatus("ready");

        api.addEventListener("readyToClose", () => {
          onCallEnded?.();
        });

        api.addEventListener("participantJoined", (event) => {
          onParticipantJoined?.(event);
        });

        api.addEventListener("participantLeft", (event) => {
          onParticipantLeft?.(event);
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(err.message);
        }
      });

    return () => {
      cancelled = true;
      apiRef.current?.dispose();
      apiRef.current = null;
    };
    // Deliberately only re-run if the room itself changes; changing
    // displayName mid-call is rare and not worth tearing the call down for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomName]);

  return (
    <div className="relative h-full w-full bg-black">
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white">
          Connecting to the call…
        </div>
      )}
      {status === "error" && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white">
          <p>Couldn't connect to the video call.</p>
          <p className="text-white/60">{errorMessage}</p>
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
