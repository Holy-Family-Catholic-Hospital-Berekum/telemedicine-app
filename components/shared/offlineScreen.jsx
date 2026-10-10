import { Component, useEffect } from "react";
import { WifiOff } from "lucide-react";
import logo from "../../src/assets/logo.webp";

// What people see instead of a blank page when the app can't reach the
// internet: a page that couldn't load (AppErrorBoundary below), or a
// sign-in that couldn't be checked (protectedRoutes.jsx). It reloads by
// itself as soon as the connection is back. Part of the main bundle, so it
// works when nothing else can be fetched.
export function OfflineScreen({
  title = "You're offline",
  message = "Connect to the internet to continue. This page will reload by itself when you're back online.",
}) {
  useEffect(() => {
    const reload = () => window.location.reload();
    window.addEventListener("online", reload);
    return () => window.removeEventListener("online", reload);
  }, []);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-white px-6 text-center">
      <img src={logo} alt="Holy Family Catholic Hospital" className="h-16 w-16 object-contain" />
      <WifiOff size={32} className="mt-6 text-[#B23A3A]" aria-hidden="true" />
      <h1 className="mt-3 text-xl font-semibold text-[#12242C]">{title}</h1>
      <p className="mt-2 max-w-sm text-base text-[#3E4E56]">{message}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 rounded-md bg-[#0095D9] px-6 py-3 text-base font-semibold text-white"
      >
        Try again
      </button>
    </div>
  );
}

/**
 * Catches a page that fails to load or render (most often its code can't
 * be downloaded offline) and shows OfflineScreen instead of a blank page.
 */
export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("Page failed to load:", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return (
      <OfflineScreen
        title={offline ? "You're offline" : "This page couldn't load"}
        message={
          offline
            ? "Connect to the internet to continue. This page will reload by itself when you're back online."
            : "Please check your internet connection and try again."
        }
      />
    );
  }
}
