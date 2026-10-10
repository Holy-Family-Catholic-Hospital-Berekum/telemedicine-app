import { useEffect, useState } from "react";
import { X, Share, PlusSquare, Smartphone } from "lucide-react";
import logo from "../../../src/assets/logo.webp";
import {
  canPrompt,
  isInstalled,
  isIosSafari,
  onInstallChange,
  promptInstall,
} from "../../../src/installPrompt";

// Once per device, on the patient dashboard: offer to add the app to the
// home screen. Android Chrome: our button opens Chrome's install prompt.
// iPhone Safari: the two steps (Apple doesn't let websites do it). Never
// shown during a call (`hidden`), when already installed, or again after
// "Not now" (a per-device preference in localStorage).
const DISMISSED_KEY = "hfch.installPrompt.dismissed";

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Private mode / storage blocked: it may show again next visit.
  }
}

export default function InstallAppPrompt({ hidden = false }) {
  const [, rerender] = useState(0);
  const [closed, setClosed] = useState(wasDismissed);
  const [ready, setReady] = useState(false);

  useEffect(() => onInstallChange(() => rerender((n) => n + 1)), []);
  // A moment after the dashboard opens, not on top of it straight away.
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 4000);
    return () => clearTimeout(id);
  }, []);

  const ios = isIosSafari();
  if (hidden || closed || !ready || isInstalled() || (!ios && !canPrompt())) return null;

  function close() {
    rememberDismissed();
    setClosed(true);
  }

  async function install() {
    const outcome = await promptInstall();
    if (outcome) close();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0B1A1C]/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-labelledby="install-title"
        className="w-full max-w-md rounded-xl bg-white p-5 text-[#12242C] shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <img src={logo} alt="" className="h-12 w-12 shrink-0 rounded-xl bg-white object-contain" />
          <div className="flex-1">
            <h2 id="install-title" className="text-base font-semibold">
              Add the app to your phone
            </h2>
            <p className="mt-1 text-[15px] text-[#3E4E56]">
              Open your appointments with one tap from your home screen. It opens faster, even on a weak
              connection.
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="text-[#3E4E56]">
            <X size={20} />
          </button>
        </div>

        {ios ? (
          <ol className="mt-4 space-y-2 text-[15px] text-[#3E4E56]">
            <li className="flex items-center gap-2">
              <span className="font-semibold text-[#12242C]">1.</span> Tap
              <Share size={18} className="text-[#0095D9]" aria-label="Share" />
              <span className="font-medium text-[#12242C]">Share</span> at the bottom of Safari.
            </li>
            <li className="flex items-center gap-2">
              <span className="font-semibold text-[#12242C]">2.</span> Choose
              <PlusSquare size={18} className="text-[#0095D9]" aria-hidden="true" />
              <span className="font-medium text-[#12242C]">Add to Home Screen</span>.
            </li>
          </ol>
        ) : null}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={close}
            className="flex-1 rounded-md border border-[#DCE6EC] px-4 py-2.5 text-[15px] font-medium text-[#12242C]"
          >
            {ios ? "Got it" : "Not now"}
          </button>
          {!ios && (
            <button
              type="button"
              onClick={install}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[#0095D9] px-4 py-2.5 text-[15px] font-semibold text-white"
            >
              <Smartphone size={18} />
              Add to home screen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
