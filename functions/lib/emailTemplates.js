// functions/lib/emailTemplates.js
//
// Appointment emails to patients and doctors. Written to stay out of spam
// folders: a plain-text part as well as simple HTML, no images or
// attachments, no link shorteners, one link to our own site, a clear
// subject without capitals or exclamation marks, and the hospital's name
// and contact details.
//
// Doctor emails never carry the patient's name or the consultation ID:
// the doctor sees those in the portal, and starts online calls from the
// telemedicine room computer.

const {
  HOSPITAL_NAME,
  HOSPITAL_TOWN,
  HOSPITAL_PHONE,
  SITE_URL,
} = require("./mailConfig");

const TYPE_LABELS = { OPD: "General OPD", SURGICAL: "Surgical" };

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

/** "Saturday 5 October 2026 at 10:30 (Ghana time)" */
function formatWhen(date) {
  const day = date.toLocaleDateString("en-GB", {
    timeZone: "Africa/Accra",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `${day} at ${clock(date)} (Ghana time)`;
}

function clock(date) {
  return date.toLocaleTimeString("en-GB", {
    timeZone: "Africa/Accra",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortWhen(date) {
  return date.toLocaleString("en-GB", {
    timeZone: "Africa/Accra",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const firstName = (name, fallback) =>
  String(name || "").trim().split(/\s+/)[0] || fallback;

/* ------------------------------------------------------------------ */
/* content per kind                                                    */
/* ------------------------------------------------------------------ */

/** Patient emails. Returns { subject, intro, rows, paragraphs }. */
function patientContent(kind, data, when) {
  const online = data.mode === "online";
  const typeLabel = TYPE_LABELS[data.type] || "Consultation";
  const rows = [
    ["When", formatWhen(when)],
    ["Doctor", data.doctorName || "To be confirmed"],
    ["Consultation", `${typeLabel}, ${online ? "online (video)" : "in person"}`],
    ["Booking reference", data.consultationId],
  ];
  const howTo = online
    ? [
      "This is a video consultation.",
      "Sign in to the hospital website, go to My appointments and tap Join call. You can join from 30 minutes before your appointment.",
      "Please join from a quiet, private place with a good internet connection.",
    ]
    : [
      `This is an in-person consultation at ${HOSPITAL_NAME}, ${HOSPITAL_TOWN}.`,
      "Please arrive 15 minutes early and bring this booking reference.",
    ];
  const change = `If you can't make it, tap "Change appointment time" on the website or call us on ${HOSPITAL_PHONE}.`;

  // The no-show rule, stated plainly wherever a patient is told about an
  // appointment (data.noShow: { waitMinutes, rescheduleFee, forfeitPercent }).
  const ns = data.noShow;
  const fee = ns ? `GHS ${Number(ns.rescheduleFee || 0)}` : "";
  const noShowRule = ns
    ? online
      ? `Please be on time. Whoever is in the video room first waits up to ${ns.waitMinutes} minutes for the other (counted from the start time, or from when they joined if later). If your doctor is waiting and you don't join in that time, the consultation is marked as missed (a no-show): to book a new time after that, you pay an extra fee of ${fee}, or you can ask for a refund, minus ${ns.forfeitPercent}% of what you paid. If your doctor doesn't join in time, you get a new time at no cost or a full refund.`
      : `Please be on time. If you don't arrive within ${ns.waitMinutes} minutes of the start, the consultation may be marked as missed (a no-show). To book a new time after that, you pay an extra fee of ${fee}; or you can ask for a refund, minus ${ns.forfeitPercent}% of what you paid.`
    : null;
  // A free hospital visit: say what to pay at the hospital, and that a
  // missed visit simply needs booking again (no fee, nothing to refund).
  const payNote = data.payAtHospital
    ? `You pay${data.amountDue ? ` GHS ${data.amountDue}` : ""} at the hospital when you come for your visit.`
    : null;
  const rule = data.payAtHospital
    ? ns
      ? `Please be on time. If you don't arrive within ${ns.waitMinutes} minutes of the start, the visit may be marked as missed and you will need to book again.`
      : null
    : noShowRule;
  const withRule = (list) => [...list, ...(payNote ? [payNote] : []), ...(rule ? [rule] : [])];

  switch (kind) {
    case "appointment_rescheduled":
      return {
        subject: `Your consultation has moved to ${shortWhen(when)}`,
        intro: data.afterDoctorUnavailable
          ? "Here is the new time for your consultation. We're sorry your doctor couldn't make the earlier one."
          : "Your consultation has been moved to a new time.",
        rows,
        paragraphs: withRule([...howTo, change]),
      };
    case "patient_doctor_unavailable": {
      const paid = Number(data.amountPaid || 0);
      return {
        subject: data.incomplete
          ? `Your consultation on ${shortWhen(when)} couldn't be completed`
          : `Your doctor can't make your consultation on ${shortWhen(when)}`,
        intro: data.incomplete
          ? "We're sorry: your video consultation couldn't be completed. We'll give you a new time to finish it."
          : "We're sorry: your doctor can't make this appointment, so it won't go ahead at this time.",
        rows,
        paragraphs: [
          "We will email you a new appointment time soon, at no extra cost. If you'd like to tell us a time that suits you, open your dashboard and tap \"Change appointment time\".",
          paid > 0
            ? `If you'd rather not wait, you can ask for a full refund (GHS ${paid}) from your dashboard instead.`
            : null,
          `Questions? Call us on ${HOSPITAL_PHONE}.`,
        ].filter(Boolean),
      };
    }
    case "patient_reminder":
      return data.lead === "24h"
        ? {
          subject: `Reminder: your consultation is tomorrow at ${clock(when)}`,
          intro: "This is a reminder that your consultation is in about 24 hours.",
          rows,
          paragraphs: withRule([...howTo, change]),
        }
        : {
          subject: `Reminder: your consultation starts at ${clock(when)}`,
          intro: "Your consultation starts in about an hour.",
          rows,
          paragraphs: withRule([...howTo, change]),
        };
    case "patient_not_joined":
      return {
        subject: `Your consultation started at ${clock(when)}`,
        intro: data.otherJoined
          ? data.by
            ? `Your doctor is waiting for you on the video call. Please join before ${clock(new Date(data.by))} (Ghana time).`
            : "Your doctor is waiting for you on the video call."
          : "Your video consultation is due now and you haven't joined yet.",
        rows,
        paragraphs: withRule([
          "Sign in to your dashboard, open this booking and press Join call.",
          `If you can't join now, tap "Change appointment time" on the website to choose another time, or call us on ${HOSPITAL_PHONE}.`,
        ]),
      };
    case "patient_doctor_waiting": {
      const by = data.noShowAt ? clock(new Date(data.noShowAt)) : null;
      return {
        subject: "Your doctor is waiting for you now",
        intro: by
          ? `Your doctor is waiting for you on the video call. Please join before ${by} (Ghana time).`
          : "Your doctor is waiting for you on the video call. Please join now.",
        rows,
        paragraphs: withRule([
          "Sign in to your dashboard, open this booking and press Join call.",
        ]),
      };
    }
    case "patient_no_show": {
      const until = data.holdUntil ? formatWhen(new Date(data.holdUntil)).replace(/ at .*$/, "") : null;
      const paid = Number(data.amountPaid || 0);
      const back = ns ? Math.round(paid * (1 - (ns.forfeitPercent || 0) / 100) * 100) / 100 : paid;
      return {
        subject: "You missed your consultation: book a new time or ask for a refund",
        intro: data.byPatient
          ? "You asked for a new time after your consultation had started, so it counts as missed (a no-show)."
          : "You didn't join your consultation in time, so it was marked as missed (a no-show).",
        rows,
        paragraphs: [
          ns && Number(ns.rescheduleFee) > 0
            ? `To see a doctor at a new time, open your dashboard and choose "Book a new time". There is an extra fee of ${fee}.`
            : "To see a doctor at a new time, open your dashboard and choose \"Book a new time\".",
          ns
            ? `Or ask for a refund from your dashboard: GHS ${back} of the GHS ${paid} you paid (${ns.forfeitPercent}% is kept for the missed appointment).`
            : "Or ask for a refund from your dashboard.",
          until
            ? `Please choose by ${until}. After that the booking is closed and its details are deleted.`
            : "Please choose soon; after 14 days the booking is closed and its details are deleted.",
          `Questions? Call us on ${HOSPITAL_PHONE}.`,
        ],
      };
    }
    default: // appointment_scheduled
      return {
        subject: `Your consultation is booked for ${shortWhen(when)}`,
        intro: "Your consultation has been scheduled.",
        rows,
        paragraphs: withRule([...howTo, change]),
      };
  }
}

/** Doctor emails. Returns { subject, intro, rows, paragraphs }. */
function doctorContent(kind, data, when) {
  const online = data.mode === "online";
  const typeLabel = TYPE_LABELS[data.type] || "Consultation";
  const rows = [
    ["When", formatWhen(when)],
    ["Consultation", `${typeLabel}, ${online ? "online (video)" : "in person"}`],
  ];
  const howTo = online
    ? "Start the call from the telemedicine room computer: sign in to the doctor portal there and choose Start video call. The video room opens 30 minutes before the appointment."
    : "The patient will come to the hospital for this consultation.";
  const portal = "Patient details are in the doctor portal.";
  // Being on time (data.noShow: the no-show policy; the same waiting time
  // applies to both sides of an online call, lib/consultationLifecycle.js).
  const wait = Number(data.noShow?.waitMinutes ?? data.waitMinutes) || null;
  const cantMakeIt =
    "If you can't make it, tap \"I can't make it\" on this consultation in the doctor portal as early as you can, so the patient is told and given a new time.";
  const onTime = online && wait
    ? `Please be on time. If you haven't joined the video call within ${wait} minutes of the start time (or of the patient joining, if later), the appointment counts as one you couldn't make: the patient is told and the hospital gives them a new time or a refund.`
    : null;
  const doctorRules = [onTime, cantMakeIt].filter(Boolean);

  switch (kind) {
    case "doctor_rescheduled":
      return {
        subject: `Consultation moved to ${shortWhen(when)}`,
        intro: "One of your consultations has been moved to a new time.",
        rows,
        paragraphs: [howTo, portal, ...doctorRules],
      };
    case "doctor_missed":
      return {
        subject: `You didn't join your ${clock(when)} consultation`,
        intro: wait
          ? `You hadn't joined this video consultation within ${wait} minutes of the start time, so it counts as one you couldn't make.`
          : "You didn't join this video consultation in time, so it counts as one you couldn't make.",
        rows,
        paragraphs: [
          "The patient has been told, and the hospital will give them a new time or a refund. You don't need to do anything now.",
          "Please be on time for your video consultations, and if you can't make one, tap \"I can't make it\" in the doctor portal beforehand.",
        ],
      };
    case "doctor_unassigned":
      return {
        subject: `Consultation on ${shortWhen(when)} moved to another doctor`,
        intro: "This consultation is no longer assigned to you. You don't need to do anything.",
        rows,
        paragraphs: [],
      };
    case "doctor_reminder":
      return data.lead === "24h"
        ? {
          subject: `Reminder: consultation tomorrow at ${clock(when)}`,
          intro: "You have a consultation in about 24 hours.",
          rows,
          paragraphs: [howTo, portal, ...doctorRules],
        }
        : {
          subject: `Reminder: consultation at ${clock(when)}`,
          intro: "You have a consultation in about an hour.",
          rows,
          paragraphs: [howTo, portal, ...doctorRules],
        };
    case "doctor_not_joined": {
      const by = data.by
        ? clock(new Date(data.by))
        : wait
          ? clock(new Date(when.getTime() + wait * 60 * 1000))
          : null;
      return {
        subject: data.otherJoined
          ? `Your patient is waiting (${clock(when)} consultation)`
          : `Your ${clock(when)} consultation is due`,
        intro: data.otherJoined
          ? "Your patient has joined the video room and is waiting for you."
          : "Your online consultation is due now and you haven't joined the call yet.",
        rows,
        paragraphs: [
          by
            ? `Please go to the telemedicine room and start the call from the doctor portal before ${by} (Ghana time). After that, the appointment counts as one you couldn't make, and the patient is told.`
            : "Please go to the telemedicine room and start the call from the doctor portal.",
          "If you can't take this consultation, tap \"I can't make it\" on it in the doctor portal.",
        ],
      };
    }
    default: // doctor_assigned
      return {
        subject: `New consultation on ${shortWhen(when)}`,
        intro: "A consultation has been assigned to you.",
        rows,
        paragraphs: [howTo, portal, ...doctorRules],
      };
  }
}

const REPORTED_BY = {
  call_incomplete: "The video call was connected but couldn't be completed.",
  doctor: "The doctor reported that they can't make it.",
  admin: "An admin reported that the doctor can't make it.",
  system: "The doctor hadn't joined the video call within the waiting time.",
};

/** Admin emails. No patient name: admins look the booking up by reference. */
function adminContent(kind, data, when) {
  const online = data.mode === "online";
  const typeLabel = TYPE_LABELS[data.type] || "Consultation";
  if (kind === "admin_new_booking") {
    const asked = [
      data.requestedDoctorName || null,
      data.preferredAt ? formatWhen(new Date(data.preferredAt)) : null,
    ].filter(Boolean);
    return {
      subject: `New booking: ${typeLabel}, ${online ? "video call" : "hospital visit"}`,
      intro: "A new consultation has been booked and needs a doctor and a time.",
      rows: [
        ["Booked", formatWhen(when)],
        ["Consultation", `${typeLabel}, ${online ? "online (video)" : "in person"}`],
        [
          "Payment",
          data.payAtHospital
            ? `Pays at the hospital (GHS ${data.amount})`
            : `Paid online (GHS ${data.amount})`,
        ],
        ...(asked.length ? [["Patient asked for", asked.join(", ")]] : []),
        ["Booking ID", data.bookingId],
      ],
      paragraphs: [
        "Please assign a doctor and a time in the admin portal: Bookings, then To schedule. The patient is emailed as soon as it's scheduled.",
      ],
    };
  }
  return {
    subject:
      data.kind === "call_incomplete"
        ? `Video consultation on ${shortWhen(when)} couldn't be completed: needs a new time`
        : `Doctor can't make a consultation on ${shortWhen(when)}: needs a new time`,
    intro:
      (data.kind === "call_incomplete" ? REPORTED_BY.call_incomplete : REPORTED_BY[data.by]) ||
      "The doctor can't make this consultation.",
    rows: [
      ["When", formatWhen(when)],
      ["Doctor", data.doctorName || "Not recorded"],
      ["Consultation", `${typeLabel}, ${online ? "online (video)" : "in person"}`],
      ["Booking reference", data.consultationId],
    ],
    paragraphs: [
      data.patientJoined && data.kind !== "call_incomplete"
        ? "The patient had joined the video call and was waiting."
        : null,
      "The patient has been emailed. Please give them a new time (with this or another doctor, no fee): Bookings, then Reschedule requests. They may ask for a full refund instead.",
    ].filter(Boolean),
  };
}

/* ------------------------------------------------------------------ */
/* rendering                                                           */
/* ------------------------------------------------------------------ */

/**
 * kind: "appointment_scheduled" | "appointment_rescheduled" |
 *       "patient_reminder" | "patient_not_joined" | "patient_doctor_waiting" |
 *       "patient_no_show" | "patient_doctor_unavailable" |
 *       "doctor_assigned" | "doctor_rescheduled" | "doctor_unassigned" |
 *       "doctor_reminder" | "doctor_not_joined" | "doctor_missed" |
 *       "admin_doctor_unavailable" | "admin_new_booking"
 * data: { scheduledAt (ms), type, mode, doctorName, patientName?,
 *         consultationId? (patients only), lead? ("24h" | "1h"),
 *         otherJoined?, noShow? (policy), afterDoctorUnavailable?,
 *         amountPaid?, waitMinutes? (doctor_missed) }
 * Returns { subject, text, html }.
 */
function renderEmail(kind, data) {
  const when = new Date(data.scheduledAt);
  const forDoctor = kind.startsWith("doctor_");
  const forAdmin = kind.startsWith("admin_");
  const { subject, intro, rows, paragraphs } = forAdmin
    ? adminContent(kind, data, when)
    : forDoctor
      ? doctorContent(kind, data, when)
      : patientContent(kind, data, when);
  const hello = forAdmin
    ? "Hello,"
    : forDoctor
      ? `Hello ${data.doctorName ? String(data.doctorName).trim() : "Doctor"},`
      : `Hello ${firstName(data.patientName, "there")},`;
  // Admins: no link (the staff sign-in address is never put in emails).
  const link = forAdmin
    ? null
    : forDoctor
      ? { href: `${SITE_URL}/doctor`, label: "Open the doctor portal" }
      : { href: `${SITE_URL}/dashboard`, label: "Open your dashboard" };
  // No-reply sender (lib/mailConfig.js): say so, and where to get help.
  const noReply = forAdmin
    ? "This is an automated email; replies to it aren't read."
    : `This is an automated email; replies to it aren't read. Questions? Call ${HOSPITAL_PHONE}.`;
  const footer = forAdmin
    ? "You are receiving this email because you are an administrator of the hospital's telemedicine service."
    : forDoctor
      ? "You are receiving this email because you are a doctor on the hospital's telemedicine service."
      : "You are receiving this email because you booked a consultation with us.";

  const text = [
    hello,
    "",
    intro,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    ...(link ? [`${link.label}: ${link.href}`, ""] : []),
    HOSPITAL_NAME,
    HOSPITAL_TOWN,
    "",
    footer,
    noReply,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f5f7f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f8;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;font-family:Arial,Helvetica,sans-serif;color:#12242c;">
<tr><td style="padding:24px 28px 8px;font-size:18px;font-weight:bold;color:#0b6ba0;">${escapeHtml(HOSPITAL_NAME)}</td></tr>
<tr><td style="padding:8px 28px;font-size:15px;line-height:1.5;">
<p style="margin:0 0 12px;">${escapeHtml(hello)}</p>
<p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 16px;">
${rows.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#5c6b72;font-size:14px;white-space:nowrap;vertical-align:top;">${escapeHtml(k)}</td><td style="padding:6px 0;font-size:15px;font-weight:bold;">${escapeHtml(v)}</td></tr>`).join("\n")}
</table>
${paragraphs.map((p) => `<p style="margin:0 0 10px;">${escapeHtml(p)}</p>`).join("\n")}
${link ? `<p style="margin:16px 0;"><a href="${escapeHtml(link.href)}" style="color:#0095d9;">${escapeHtml(link.label)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:16px 28px 24px;font-size:12px;color:#5c6b72;border-top:1px solid #e4eaee;">
${escapeHtml(HOSPITAL_NAME)}, ${escapeHtml(HOSPITAL_TOWN)}<br>
${escapeHtml(footer)}<br>
${escapeHtml(noReply)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}

module.exports = { renderEmail };
