// functions/lib/mailConfig.js
//
// Appointment email settings. Not secret (the Resend API key is a secret:
// firebase functions:secrets:set RESEND_API_KEY).
//
// DELIVERABILITY: emails land in the inbox, not spam, only when they are
// sent from a domain the hospital owns that is verified in Resend (SPF and
// DKIM DNS records) and has a DMARC record. Until FROM uses that verified
// domain, sending is refused rather than risking the spam folder.
//
// Keep HOSPITAL_PHONE in step with components/shared/contact.js.

const settings = {
  // e.g. "Holy Family Catholic Hospital <appointments@hfch.org>"
  FROM: "Holy Family Catholic Hospital <appointments@example.com>",
  // A mailbox staff actually read; patients' replies go here.
  REPLY_TO: "appointments@example.com",
  HOSPITAL_NAME: "Holy Family Catholic Hospital",
  HOSPITAL_TOWN: "Berekum, Ghana",
  HOSPITAL_PHONE: "024 000 0000",
  SITE_URL: "https://telemedicine-hfch.vercel.app",
};

// True once FROM uses a real (verified) domain. Until then the email
// functions aren't deployed (they need the RESEND_API_KEY secret) and
// bookings show "Email not set up" to admins.
settings.EMAIL_CONFIGURED = !/@example\.com/i.test(settings.FROM);

module.exports = settings;
