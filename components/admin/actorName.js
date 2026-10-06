// actorName.js
//
// Turns the account ID stored on an audit entry into something a person
// can read: the staff member's or patient's name (from the accounts the
// admin dashboard has loaded), "System" for scheduled jobs and scripts,
// or a shortened ID when the account isn't loaded (e.g. an older patient).

const SYSTEM_IDS = new Set(["system", "script"]);

export function actorLabel(id, names) {
  if (!id) return { name: "Unknown", known: false };
  if (SYSTEM_IDS.has(id)) return { name: "System", known: true };
  const hit = names?.get(id);
  if (hit?.name) return { name: hit.name, known: true };
  return { name: `Account ${String(id).slice(0, 8)}…`, known: false };
}
