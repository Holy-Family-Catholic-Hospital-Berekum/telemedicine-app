// functions/support.js
//
// In-app support messages between patients and the hospital's admins
// (the floating "Help" button on patient pages, admin "Customer support"
// tab). Signed-out visitors get the WhatsApp fallback instead.
//
//   sendSupportMessage   patient: starts a conversation or writes in one
//   replySupportMessage  admin: answers (the patient is emailed the reply)
//   claimSupportThread   admin: "I'm handling this" (or lets it go)
//   closeSupportThread   patient ("My question is answered") or admin
//   markSupportRead      patient: has seen the latest reply
//   supportHousekeeping  hourly task: closes answered conversations left
//                        for AUTO_CLOSE_DAYS, deletes closed ones after
//                        DELETE_AFTER_CLOSE_DAYS (hospital decision: 30)
//
// Data (written only here; firestore.rules):
//   supportThreads/{id}          the patient's own conversation (patient +
//                                admins read): status waiting | answered |
//                                closed, unreadByPatient, preview, topic,
//                                the booking it's about
//   supportThreads/{id}/messages {from: "patient" | "support", text, at}
//   supportStaff/{id}            admins only: who's handling it and which
//                                admin wrote each reply. Kept apart so no
//                                staff uid sits in a patient-readable record
//                                (replies show as "Holy Family support").
//
// Patients need a verified email: replies are emailed, and must not go to
// an address the account holder hasn't proved is theirs. Admin emails
// carry no patient name and no message text (like the other admin emails).
// Messages are plain text, rendered as text everywhere and escaped in
// emails. The audit log records who did what, never the message text.

const logger = require("firebase-functions/logger");
const { task } = require("./lib/task");
const {
  onCall,
  db,
  FieldValue,
  Timestamp,
  serverTime,
  HttpsError,
  requireRole,
  requireVerifiedEmail,
  requestMeta,
  str,
  oneOf,
  docId,
  audit,
  rateLimit,
  rateLimitIp,
  deleteTree,
} = require("./lib/core");
const { queueEmail, emailAdmins } = require("./lib/mailQueue");
const {
  TOPICS,
  LIMITS,
  AUTO_CLOSE_DAYS,
  DELETE_AFTER_CLOSE_DAYS,
  DAY_MS,
  isOfficeOpen,
  nextOpening,
  needsAfterHoursNotice,
  cleanText,
  preview,
} = require("./lib/support");

const threads = () => db.collection("supportThreads");
const staffDoc = (threadId) => db.collection("supportStaff").doc(threadId);
const OPEN_STATUSES = ["waiting", "answered"];
// Reply emails are dropped if they can't go out in this time.
const REPLY_EMAIL_WINDOW_MS = 3 * DAY_MS;

const notFound = () => new HttpsError("not-found", "We couldn't find that conversation.");

function messageText(value) {
  const text = cleanText(str(value, { field: "Message", max: LIMITS.text, min: 2 }));
  if (text.length < 2) throw new HttpsError("invalid-argument", "Message is required.");
  return text;
}

function assertRoom(thread) {
  if ((thread.messageCount || 0) >= LIMITS.messagesPerThread) {
    throw new HttpsError("failed-precondition", "This conversation is full. Please start a new one.");
  }
}

/** The patient's own confirmed booking, as shown on the conversation. */
async function linkedBooking(uid, bookingId) {
  // deepcode ignore Sqli: Firestore document ID (validated by docId), not SQL.
  const snap = await db.collection("bookings").doc(bookingId).get();
  const b = snap.exists ? snap.data() : null;
  if (!b || b.patientUid !== uid || !["paid", "scheduled", "no_show"].includes(b.status)) {
    throw new HttpsError("invalid-argument", "Choose one of your bookings.");
  }
  return {
    id: snap.id,
    consultationId: b.consultationId || null,
    type: b.type || null,
    mode: b.mode || null,
    scheduledTime: b.scheduledTime || null,
  };
}

/**
 * data: { text, threadId? } to write in a conversation, or
 *       { text, topic, bookingId? } to start one.
 * Resolves { threadId, officeOpen, opensAt (ms) }.
 */
exports.sendSupportMessage = onCall(async (request) => {
  const caller = await requireRole(request, ["patient"]);
  requireVerifiedEmail(caller);
  const d = request.data || {};
  const text = messageText(d.text);
  const threadId = d.threadId ? docId(d.threadId, "Conversation") : null;
  const topic = threadId ? null : oneOf(d.topic, Object.keys(TOPICS), "topic");
  await rateLimit(caller.uid, "supportMessage", { max: 20, windowSeconds: 3600 });
  await rateLimitIp(request.rawRequest, "supportMessage", { max: 60, windowSeconds: 3600 });
  const booking = !threadId && d.bookingId
    ? await linkedBooking(caller.uid, docId(d.bookingId, "Booking"))
    : null;

  const now = new Date();
  const opensAt = nextOpening(now).getTime();
  const name = caller.profile.name || null;
  const email = caller.profile.email || caller.token.email || null;

  const sent = await db.runTransaction(async (tx) => {
    const ref = threadId ? threads().doc(threadId) : threads().doc();
    let thread = null;
    if (threadId) {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().patientUid !== caller.uid) throw notFound();
      thread = snap.data();
      assertRoom(thread);
    }
    // Starting or reopening one: at most LIMITS.openThreads open at a time.
    if (!thread || thread.status === "closed") {
      const open = await tx.get(
        threads().where("patientUid", "==", caller.uid).where("status", "in", OPEN_STATUSES),
      );
      if (open.size >= LIMITS.openThreads) {
        throw new HttpsError(
          "failed-precondition",
          `You already have ${LIMITS.openThreads} open conversations. Please write in one of those, or mark one as answered.`,
        );
      }
    }

    tx.set(ref.collection("messages").doc(), { from: "patient", text, at: serverTime() });
    const notice = needsAfterHoursNotice(now, thread?.afterHoursNoticeFor);
    const update = {
      status: "waiting",
      lastFrom: "patient",
      lastMessageAt: serverTime(),
      preview: preview(text),
      unreadByPatient: false,
      // How long it has been waiting for us (admin list).
      waitingSince: thread?.status === "waiting" ? thread.waitingSince : serverTime(),
      ...(notice ? { afterHoursNoticeFor: opensAt } : {}),
    };
    if (thread) {
      tx.update(ref, {
        ...update,
        messageCount: FieldValue.increment(1),
        closedAt: FieldValue.delete(),
        deleteAt: FieldValue.delete(),
      });
    } else {
      tx.set(ref, {
        ...update,
        patientUid: caller.uid,
        patientName: name,
        patientEmail: email,
        topic,
        booking,
        messageCount: 1,
        createdAt: serverTime(),
      });
      audit(tx, {
        actorId: caller.uid,
        actorRole: "patient",
        action: "Sent a message to support",
        code: "support.thread_opened",
        category: "support",
        targetType: "supportThread",
        targetId: ref.id,
        patientUid: caller.uid,
        details: { topic },
        meta: requestMeta(request),
      });
    }
    if (notice) {
      queueEmail(tx, {
        to: email,
        kind: "support_after_hours",
        data: { scheduledAt: now.getTime(), patientName: name, topic: thread?.topic ?? topic, opensAt },
        sendBefore: opensAt,
      });
    }
    return { id: ref.id, topic: thread?.topic ?? topic, newlyWaiting: thread?.status !== "waiting", reopened: !!thread };
  });

  // Admins hear about a conversation when it starts waiting for us, not
  // for every message in it.
  if (sent.newlyWaiting) {
    await emailAdmins("admin_support_message", {
      scheduledAt: now.getTime(),
      topic: sent.topic,
      reopened: sent.reopened,
    }).catch((err) => logger.error("Support email to admins couldn't be queued", { err: err.message }));
  }
  return { threadId: sent.id, officeOpen: isOfficeOpen(now), opensAt };
});

/** data: { threadId, text }. The patient is emailed the reply. */
exports.replySupportMessage = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const d = request.data || {};
  const threadId = docId(d.threadId, "Conversation");
  const text = messageText(d.text);
  await rateLimit(caller.uid, "supportReply", { max: 120, windowSeconds: 3600 });
  const ref = threads().doc(threadId);
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    // deepcode ignore Sqli: Firestore document ID (validated by docId), not SQL.
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound();
    const thread = snap.data();
    assertRoom(thread);
    const staff = await tx.get(staffDoc(threadId));
    // The patient's current address (it may have changed since they wrote).
    // deepcode ignore Sqli: Firestore document ID, not SQL; the uid on the server-written conversation.
    const user = await tx.get(db.collection("users").doc(thread.patientUid));

    const msgRef = ref.collection("messages").doc();
    tx.set(msgRef, { from: "support", text, at: serverTime() });
    tx.update(ref, {
      status: "answered",
      lastFrom: "support",
      lastMessageAt: serverTime(),
      preview: preview(text),
      unreadByPatient: true,
      waitingSince: null,
      messageCount: FieldValue.increment(1),
      closedAt: FieldValue.delete(),
      deleteAt: FieldValue.delete(),
    });
    tx.set(
      staffDoc(threadId),
      {
        replies: { [msgRef.id]: caller.uid },
        // Whoever answers first is handling it, unless someone already is.
        ...(staff.data()?.handledBy ? {} : { handledBy: { uid: caller.uid, at: serverTime() } }),
      },
      { merge: true },
    );
    if (user.exists) {
      queueEmail(tx, {
        to: user.data().email || thread.patientEmail,
        kind: "support_reply",
        data: { scheduledAt: now, patientName: user.data().name || thread.patientName, topic: thread.topic, reply: text },
        sendBefore: now + REPLY_EMAIL_WINDOW_MS,
      });
    }
    audit(tx, {
      actorId: caller.uid,
      actorRole: "admin",
      action: "Replied to a support message",
      code: "support.replied",
      category: "support",
      targetType: "supportThread",
      targetId: threadId,
      patientUid: thread.patientUid,
      details: { messageId: msgRef.id },
      meta: requestMeta(request),
    });
  });
  return { ok: true };
});

/** data: { threadId, release? }: take the conversation (or let it go). */
exports.claimSupportThread = onCall(async (request) => {
  const caller = await requireRole(request, ["admin"]);
  const threadId = docId(request.data?.threadId, "Conversation");
  const release = request.data?.release === true;
  await db.runTransaction(async (tx) => {
    const [thread, staff] = await Promise.all([tx.get(threads().doc(threadId)), tx.get(staffDoc(threadId))]);
    if (!thread.exists) throw notFound();
    const current = staff.data()?.handledBy;
    if (release) {
      if (current?.uid === caller.uid) tx.set(staffDoc(threadId), { handledBy: null }, { merge: true });
      return;
    }
    tx.set(staffDoc(threadId), { handledBy: { uid: caller.uid, at: serverTime() } }, { merge: true });
  });
  return { ok: true };
});

/** data: { threadId }. Closed conversations are deleted after 30 days. */
exports.closeSupportThread = onCall(async (request) => {
  const caller = await requireRole(request, ["patient", "admin"]);
  const threadId = docId(request.data?.threadId, "Conversation");
  const ref = threads().doc(threadId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const thread = snap.exists ? snap.data() : null;
    if (!thread || (caller.role === "patient" && thread.patientUid !== caller.uid)) throw notFound();
    if (thread.status === "closed") return;
    tx.update(ref, {
      status: "closed",
      closedAt: serverTime(),
      deleteAt: Timestamp.fromMillis(Date.now() + DELETE_AFTER_CLOSE_DAYS * DAY_MS),
      waitingSince: null,
    });
    audit(tx, {
      actorId: caller.uid,
      actorRole: caller.role,
      action: caller.role === "patient" ? "Marked their support question as answered" : "Closed a support conversation",
      code: "support.closed",
      category: "support",
      targetType: "supportThread",
      targetId: threadId,
      patientUid: thread.patientUid,
      meta: requestMeta(request),
    });
  });
  return { ok: true };
});

/** data: { threadId }: the patient has seen the latest reply. */
exports.markSupportRead = onCall(async (request) => {
  const caller = await requireRole(request, ["patient"]);
  const ref = threads().doc(docId(request.data?.threadId, "Conversation"));
  const snap = await ref.get();
  if (!snap.exists || snap.data().patientUid !== caller.uid) throw notFound();
  if (snap.data().unreadByPatient) await ref.update({ unreadByPatient: false });
  return { ok: true };
});

const BATCH = 200;

/** Deletes a conversation, its messages and its admin-only record. */
async function deleteThread(ref) {
  await deleteTree(ref);
  await staffDoc(ref.id).delete();
}

exports.supportHousekeeping = task("supportHousekeeping", { schedule: "every 60 minutes", timeoutSeconds: 300 }, async () => {
  const now = Date.now();
  const stale = await threads()
    .where("status", "==", "answered")
    .where("lastMessageAt", "<", Timestamp.fromMillis(now - AUTO_CLOSE_DAYS * DAY_MS))
    .limit(BATCH)
    .get();
  if (!stale.empty) {
    const batch = db.batch();
    stale.docs.forEach((doc) =>
      batch.update(doc.ref, {
        status: "closed",
        closedAt: serverTime(),
        deleteAt: Timestamp.fromMillis(now + DELETE_AFTER_CLOSE_DAYS * DAY_MS),
      }));
    await batch.commit();
  }

  const expired = await threads()
    .where("status", "==", "closed")
    .where("deleteAt", "<", Timestamp.fromMillis(now))
    .limit(BATCH)
    .get();
  await Promise.all(expired.docs.map((doc) => deleteThread(doc.ref)));
  if (stale.size || expired.size) {
    logger.info("Support conversations tidied", { closed: stale.size, deleted: expired.size });
  }
});

/** Every conversation of a patient (account deleted: lib/accountDeletion.js). */
async function deletePatientThreads(uid) {
  // deepcode ignore Sqli: Firestore equality filter on the account's own uid (from Auth), not SQL.
  const snap = await threads().where("patientUid", "==", uid).get();
  await Promise.all(snap.docs.map((doc) => deleteThread(doc.ref)));
  return snap.size;
}
exports.deletePatientThreads = deletePatientThreads;
