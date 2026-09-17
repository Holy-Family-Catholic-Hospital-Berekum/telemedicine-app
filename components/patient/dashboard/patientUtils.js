const UNLOCK_WINDOW_MS = 5 * 60 * 1000;

// Same rule as the doctor dashboard's getCallWindow — a video consultation
// only opens 5 minutes before its scheduled time. Kept in sync deliberately;
// if you change one, change the other.
export function getCallWindow(scheduledTime, now = new Date()) {
  const scheduledMs = new Date(scheduledTime).getTime();
  const unlockAtMs = scheduledMs - UNLOCK_WINDOW_MS;
  const nowMs = now.getTime();
  const unlocked = nowMs >= unlockAtMs;
  const minutesUntilUnlock = unlocked ? 0 : Math.ceil((unlockAtMs - nowMs) / 60000);
  return { unlocked, minutesUntilUnlock };
}

export function formatCurrency(amount) {
  return `GHS ${amount.toFixed(2)}`;
}

export function formatCountdown(expiresAt, now = new Date()) {
  const diffMs = new Date(expiresAt).getTime() - now.getTime();
  if (diffMs <= 0) return 'Expired';
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const minutes = Math.floor((diffMs % (60 * 60 * 1000)) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

export function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}