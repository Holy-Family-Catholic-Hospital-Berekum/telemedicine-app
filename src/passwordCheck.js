// passwordCheck.js
//
// Has this password appeared in a data leak from another website? Checked
// against Have I Been Pwned's Pwned Passwords list without sending the
// password: the browser hashes it (SHA-1) and sends only the first 5
// characters of the hash; the service returns every leaked hash starting
// with them (padded with decoys) and the match is done here.
// https://haveibeenpwned.com/API/v3#PwnedPasswords
//
// Used at sign-up (a leaked password is refused) and at patient sign-in (a
// warning on the dashboard). If the service can't be reached the check is
// skipped: it must never stop someone signing in.

const RANGE_URL = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 4000;

/** How many times it was seen in leaks (0 = never); null if unknown. */
export async function passwordLeakCount(password) {
  if (!password || !globalThis.crypto?.subtle) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    const res = await fetch(RANGE_URL + hash.slice(0, 5), {
      headers: { "Add-Padding": "true" },
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) return null;
    const suffix = hash.slice(5);
    for (const line of (await res.text()).split("\n")) {
      const [rest, count] = line.trim().split(":");
      if (rest === suffix) return Number(count) || 0;
    }
    return 0;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
