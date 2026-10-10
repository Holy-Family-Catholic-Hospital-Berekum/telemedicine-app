import { RefreshCw, X } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";

// Registers the service worker (vite.config.js VitePWA) and, when a new
// version of the app has downloaded, offers to switch to it. It never
// reloads by itself, so an update can't cut a video call or a payment.
export default function AppUpdate() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(err) {
      console.warn("Service worker registration failed:", err);
    },
  });

  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-lg bg-[#12242C] px-4 py-3 text-[14px] text-white shadow-xl"
    >
      <RefreshCw size={18} className="shrink-0 text-[#8FD3F5]" />
      <span className="flex-1">A new version of the app is ready.</span>
      <button
        type="button"
        onClick={() => updateServiceWorker(true)}
        className="rounded-md bg-[#0095D9] px-3 py-1.5 font-semibold"
      >
        Refresh
      </button>
      <button type="button" onClick={() => setNeedRefresh(false)} aria-label="Later" className="text-white/70">
        <X size={18} />
      </button>
    </div>
  );
}
