import { WifiOff, Loader2 } from "lucide-react";
import { useNetworkStatus } from "../../src/networkStatus";

// A thin bar at the top of every page when the connection is gone or slow
// (src/networkStatus.js). Plain words for patients; nothing to tap: the app
// carries on by itself when the connection comes back.
export default function NetworkBanner() {
  const { offline, slow } = useNetworkStatus();
  if (!offline && !slow) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 px-4 py-2 text-center text-[14px] font-medium text-white shadow-md"
      style={{ backgroundColor: offline ? "#B23A3A" : "#2A3B44" }}
    >
      {offline ? (
        <>
          <WifiOff size={16} className="shrink-0" />
          You&apos;re offline. We&apos;ll carry on when your connection is back.
        </>
      ) : (
        <>
          <Loader2 size={16} className="shrink-0 animate-spin" />
          Your connection is slow. Still trying…
        </>
      )}
    </div>
  );
}
