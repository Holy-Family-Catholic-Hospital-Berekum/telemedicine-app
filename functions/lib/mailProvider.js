// functions/lib/mailProvider.js
//
// The email service that sends the outbox (email.js). One setting picks it:
// MAIL_PROVIDER in the project's functions env file
// (functions/.env.<project id>): "resend" (the default) or "brevo".
// Each needs its own API key as a function secret, set by the owner:
//
//   resend   firebase functions:secrets:set RESEND_API_KEY --project <live|test>
//   brevo    firebase functions:secrets:set BREVO_API_KEY  --project <live|test>
//
// Only the chosen provider's secret is declared, so the other one doesn't
// have to exist. Switching: set the new secret, add the sending domain's
// DNS records at the provider, change MAIL_PROVIDER, redeploy the email
// functions. Both send from lib/mailConfig.js FROM (the hospital's domain).
//
// send() resolves to { ok, status, providerId, error }: status 0 means the
// service couldn't be reached. email.js treats 0, 429 and 5xx as temporary
// (retried) and anything else as final.

const { defineSecret } = require("firebase-functions/params");

const PROVIDERS = {
  resend: { secret: defineSecret("RESEND_API_KEY"), send: sendResend },
  brevo: { secret: defineSecret("BREVO_API_KEY"), send: sendBrevo },
};
const PROVIDER = String(process.env.MAIL_PROVIDER || "resend").trim().toLowerCase();
if (!PROVIDERS[PROVIDER]) {
  throw new Error(`MAIL_PROVIDER "${PROVIDER}" isn't supported (use resend or brevo).`);
}
const MAIL_SECRET = PROVIDERS[PROVIDER].secret;

/** "Name <a@b.org>" -> { name, email } */
function parseAddress(address) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(address || "");
  return m ? { name: m[1].replace(/^"|"$/g, ""), email: m[2].trim() } : { email: String(address || "").trim() };
}

async function post(url, headers, body) {
  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (err) {
    return { ok: false, status: 0, json: {}, error: err.message };
  }
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

// https://resend.com/docs/api-reference/emails/send-email
async function sendResend({ id, from, to, replyTo, subject, text, html }) {
  const r = await post(
    "https://api.resend.com/emails",
    {
      "Authorization": `Bearer ${MAIL_SECRET.value().trim()}`,
      "Content-Type": "application/json",
      // The mail document id: a retry can never deliver the same email twice.
      "Idempotency-Key": id,
    },
    { from, to: [to], ...(replyTo ? { reply_to: replyTo } : {}), subject, text, html },
  );
  return {
    ok: r.ok,
    status: r.status,
    providerId: r.json.id || null,
    error: r.error || String(r.json.message || r.json.name || ""),
  };
}

// https://developers.brevo.com/reference/sendtransacemail
// Brevo has no idempotency key; email.js claims each mail document in a
// transaction before sending, so a document is only ever sent once unless
// a send times out after Brevo accepted it (then the retry may repeat it).
async function sendBrevo({ id, kind, from, to, replyTo, subject, text, html }) {
  const r = await post(
    "https://api.brevo.com/v3/smtp/email",
    {
      "api-key": MAIL_SECRET.value().trim(),
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    {
      sender: parseAddress(from),
      to: [{ email: to }],
      ...(replyTo ? { replyTo: parseAddress(replyTo) } : {}),
      subject,
      htmlContent: html,
      textContent: text,
      // Shown in Brevo's logs, to trace a message back to its mail document.
      headers: { "X-Mail-Id": id },
      tags: kind ? [String(kind).slice(0, 50)] : undefined,
    },
  );
  return {
    ok: r.ok,
    status: r.status,
    providerId: r.json.messageId || null,
    error: r.error || String(r.json.message || r.json.code || ""),
  };
}

const send = (message) => PROVIDERS[PROVIDER].send(message);

module.exports = { PROVIDER, MAIL_SECRET, send, parseAddress };
