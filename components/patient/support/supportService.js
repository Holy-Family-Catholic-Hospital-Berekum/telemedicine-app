// components/patient/support/supportService.js
//
// Data access for the patient's Help panel. Reads come straight from
// Firestore (rules return only the signed-in patient's own conversations);
// every write is a Cloud Function (functions/support.js). Loaded only for a
// signed-in patient (components/shared/supportButton.jsx imports it on
// demand), so Firebase stays out of the public pages' first download.

import { collection, limit, onSnapshot, orderBy, query, where, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "../../../src/firebase";
import { toDate } from "../../../src/constants";
import { track, tracked } from "../../../src/networkStatus";

const threads = collection(db, "supportThreads");
const callSend = tracked(httpsCallable(functions, "sendSupportMessage"));
const callMarkRead = httpsCallable(functions, "markSupportRead");
const callClose = tracked(httpsCallable(functions, "closeSupportThread"));

const toThread = (d) => {
  const t = d.data();
  return {
    id: d.id,
    topic: t.topic,
    status: t.status,
    preview: t.preview || "",
    lastFrom: t.lastFrom,
    lastMessageAt: toDate(t.lastMessageAt),
    unread: t.unreadByPatient === true,
    booking: t.booking || null,
  };
};

/** Live: ids of the patient's conversations with a reply they haven't seen. */
export function watchUnread(uid, onChange, onError) {
  return onSnapshot(
    query(threads, where("patientUid", "==", uid), where("unreadByPatient", "==", true), limit(10)),
    (snap) => onChange(snap.docs.map((d) => d.id)),
    onError,
  );
}

/** Live: the patient's latest conversations, newest first. */
export function watchThreads(uid, onChange, onError) {
  return onSnapshot(
    query(threads, where("patientUid", "==", uid), orderBy("lastMessageAt", "desc"), limit(20)),
    (snap) => onChange(snap.docs.map(toThread)),
    onError,
  );
}

/** Live: one conversation's messages, oldest first. */
export function watchMessages(threadId, onChange, onError) {
  return onSnapshot(
    query(collection(db, "supportThreads", threadId, "messages"), orderBy("at", "asc"), limit(100)),
    (snap) =>
      onChange(
        snap.docs.map((d) => ({ id: d.id, from: d.data().from, text: d.data().text, at: toDate(d.data().at) })),
      ),
    onError,
  );
}

/** The patient's current bookings, to say which one a question is about. */
export async function fetchBookingsToLink(uid) {
  const snap = await track(
    getDocs(query(collection(db, "bookings"), where("patientUid", "==", uid), orderBy("createdAt", "desc"), limit(10))),
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((b) => ["paid", "scheduled", "no_show"].includes(b.status))
    .map((b) => ({
      id: b.id,
      consultationId: b.consultationId || null,
      type: b.type,
      mode: b.mode,
      scheduledTime: toDate(b.scheduledTime),
    }));
}

/** { text, threadId } or { text, topic, bookingId? } -> { threadId, officeOpen, opensAt } */
export async function sendSupportMessage(payload) {
  const { data } = await callSend(payload);
  return data;
}

export function markSupportRead(threadId) {
  return callMarkRead({ threadId }).catch(() => {}); // the badge just stays until next time
}

export function closeSupportThread(threadId) {
  return callClose({ threadId });
}
