import { useEffect, useRef, useState } from "react";
import { LogOut, Loader2 } from "lucide-react";

// TODO(auth): in onConfirm, call Firebase Auth's signOut(auth) and let the
// app's route guard react to the auth-state change to send the doctor back
// to the login screen. No dashboard state needs clearing by hand here.
export default function LogoutButton({ onConfirm }) {
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    function handleClickAway(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    function handleEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClickAway);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickAway);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  async function handleConfirm() {
    setLoggingOut(true);
    await onConfirm?.();
    setLoggingOut(false);
    setOpen(false);
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-sm font-medium text-[#5C6B72] transition hover:bg-[#F5F8FA] hover:text-[#B23A3A]"
      >
        <LogOut size={15} strokeWidth={1.75} />
        Log out
      </button>

      {open && (
        <div className="absolute right-0 top-full z-10 mt-2 w-60 rounded-md border border-[#DCE6EC] bg-white p-3.5 shadow-lg">
          <p className="text-sm text-[#12242C]">
            Log out of the doctor portal?
          </p>
          <p className="mt-1 text-xs text-[#5C6B72]">
            You'll need to sign back in with MFA next time.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={loggingOut}
              className="flex-1 rounded-sm border border-[#DCE6EC] py-1.5 text-xs font-medium text-[#12242C] transition hover:border-[#0095D9] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loggingOut}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-sm py-1.5 text-xs font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-70"
              style={{ backgroundColor: "#B23A3A" }}
            >
              {loggingOut && (
                <Loader2 size={12} strokeWidth={2} className="animate-spin" />
              )}
              {loggingOut ? "Logging out…" : "Log out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}