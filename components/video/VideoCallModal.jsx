import { X } from "lucide-react";
import JitsiRoom from "./JitsiRoom";
import { buildJitsiRoomName } from "./jitsiConfig";

/**
 * VideoCallModal
 *
 * Full-screen video call overlay. Used identically by the doctor
 * dashboard and the patient dashboard — pass in the consultationId and
 * the local user's display name, it handles the rest.
 *
 * Props:
 * - consultationId: string (required)
 * - displayName: string (required)
 * - onClose: () => void (required) - called when the user leaves the
 *   call or closes the modal
 */
export default function VideoCallModal({ consultationId, displayName, onClose }) {
  if (!consultationId) return null;

  const roomName = buildJitsiRoomName(consultationId);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between bg-[#12242C] px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-white/70">
          <span className="inline-block h-2 w-2 rounded-full bg-[#E4483C]" />
          Live consultation · not recorded
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium text-white/80 hover:bg-white/10"
        >
          <X size={14} strokeWidth={2} />
          Close
        </button>
      </div>

      <div className="flex-1">
        <JitsiRoom
          roomName={roomName}
          displayName={displayName}
          onCallEnded={onClose}
        />
      </div>
    </div>
  );
}
