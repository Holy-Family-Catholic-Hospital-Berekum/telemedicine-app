// functions/lib/emailTemplates.js
//
// Appointment emails. Written to stay out of spam folders: a plain-text
// part as well as simple HTML, no images or attachments, no link
// shorteners, one link to our own site, a clear subject without capitals
// or exclamation marks, and the hospital's name and contact details.

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
  const time = date.toLocaleTimeString("en-GB", {
    timeZone: "Africa/Accra",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} at ${time} (Ghana time)`;
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

/**
 * data: { patientName, doctorName, type, mode, scheduledAt (ms),
 *         consultationId }
 * kind: "appointment_scheduled" | "appointment_rescheduled"
 * Returns { subject, text, html }.
 */
function renderAppointmentEmail(kind, data) {
  const when = new Date(data.scheduledAt);
  const first = String(data.patientName || "").trim().split(/\s+/)[0] || "there";
  const typeLabel = TYPE_LABELS[data.type] || "Consultation";
  const online = data.mode === "online";
  const rescheduled = kind === "appointment_rescheduled";
  const dashboard = `${SITE_URL}/dashboard`;

  const subject = rescheduled
    ? `Your consultation has moved to ${shortWhen(when)}`
    : `Your consultation is booked for ${shortWhen(when)}`;

  const intro = rescheduled
    ? "Your consultation has been moved to a new time."
    : "Your consultation has been scheduled.";

  const howTo = online
    ? [
      "This is a video consultation.",
      "Sign in to your dashboard, open this booking and enter your consultation ID. The video room opens 30 minutes before your appointment.",
      "Please join from a quiet, private place with a good internet connection.",
    ]
    : [
      `This is an in-person consultation at ${HOSPITAL_NAME}, ${HOSPITAL_TOWN}.`,
      "Please arrive 15 minutes early and bring this consultation ID.",
    ];

  const rows = [
    ["When", formatWhen(when)],
    ["Doctor", data.doctorName || "To be confirmed"],
    ["Consultation", `${typeLabel}, ${online ? "online (video)" : "in person"}`],
    ["Consultation ID", data.consultationId],
  ];

  const text = [
    `Hello ${first},`,
    "",
    intro,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    ...howTo,
    "",
    `Your dashboard: ${dashboard}`,
    "",
    `If you need to change this appointment, use "Request reschedule" on your dashboard or call us on ${HOSPITAL_PHONE}.`,
    "",
    HOSPITAL_NAME,
    HOSPITAL_TOWN,
    "",
    "You are receiving this email because you booked a consultation with us.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f5f7f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f8;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;font-family:Arial,Helvetica,sans-serif;color:#12242c;">
<tr><td style="padding:24px 28px 8px;font-size:18px;font-weight:bold;color:#0b6ba0;">${escapeHtml(HOSPITAL_NAME)}</td></tr>
<tr><td style="padding:8px 28px;font-size:15px;line-height:1.5;">
<p style="margin:0 0 12px;">Hello ${escapeHtml(first)},</p>
<p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 16px;">
${rows.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#5c6b72;font-size:14px;white-space:nowrap;vertical-align:top;">${escapeHtml(k)}</td><td style="padding:6px 0;font-size:15px;font-weight:bold;">${escapeHtml(v)}</td></tr>`).join("\n")}
</table>
${howTo.map((p) => `<p style="margin:0 0 10px;">${escapeHtml(p)}</p>`).join("\n")}
<p style="margin:16px 0;"><a href="${escapeHtml(dashboard)}" style="color:#0095d9;">Open your dashboard</a></p>
<p style="margin:0 0 10px;">If you need to change this appointment, use "Request reschedule" on your dashboard or call us on ${escapeHtml(HOSPITAL_PHONE)}.</p>
</td></tr>
<tr><td style="padding:16px 28px 24px;font-size:12px;color:#5c6b72;border-top:1px solid #e4eaee;">
${escapeHtml(HOSPITAL_NAME)}, ${escapeHtml(HOSPITAL_TOWN)}<br>
You are receiving this email because you booked a consultation with us.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}

module.exports = { renderAppointmentEmail };
