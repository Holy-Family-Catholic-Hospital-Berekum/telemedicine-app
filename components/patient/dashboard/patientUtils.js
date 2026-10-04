import { CALL_UNLOCK_MINUTES, CALL_CLOSES_HOURS } from "../../../src/constants";

const UNLOCK_WINDOW_MS = CALL_UNLOCK_MINUTES * 60 * 1000;
const CLOSE_AFTER_MS = CALL_CLOSES_HOURS * 3600 * 1000;

// Same rule as the doctor dashboard: the video room opens
// CALL_UNLOCK_MINUTES before the scheduled time and closes
// CALL_CLOSES_HOURS after it (server enforces both). `closed` also marks
// when an in-person appointment time is well past.
export function getCallWindow(scheduledTime, now = new Date()) {
  const scheduledMs = new Date(scheduledTime).getTime();
  const unlockAtMs = scheduledMs - UNLOCK_WINDOW_MS;
  const nowMs = now.getTime();
  const unlocked = nowMs >= unlockAtMs;
  const closed = nowMs > scheduledMs + CLOSE_AFTER_MS;
  const minutesUntilUnlock = unlocked ? 0 : Math.ceil((unlockAtMs - nowMs) / 60000);
  return { unlocked, closed, minutesUntilUnlock };
}

export function formatCurrency(amount) {
  return `GHS ${Number(amount ?? 0).toFixed(2)}`;
}

export function formatCountdown(expiresAt, now = new Date()) {
  const diffMs = new Date(expiresAt).getTime() - now.getTime();
  if (diffMs <= 0) return 'Expired';
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const minutes = Math.floor((diffMs % (60 * 60 * 1000)) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

export { formatDateTime } from "../../../src/constants";