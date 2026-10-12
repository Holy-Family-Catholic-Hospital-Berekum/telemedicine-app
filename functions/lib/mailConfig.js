// functions/lib/mailConfig.js
//
// Appointment email settings. Not secret (the email service and its API key
// secret are chosen in lib/mailProvider.js).
//
// DELIVERABILITY: emails land in the inbox, not spam, only when they are
// sent from a domain the hospital owns that is verified at the email service (SPF and
// DKIM DNS records) and has a DMARC record. Until FROM uses that verified
// domain, sending is refused rather than risking the spam folder.
//
// Keep HOSPITAL_PHONE in step with components/shared/contact.js.

const settings = {
  // Sending subdomain verified at the email service (DNS on Cloudflare), so the
  // hospital's main hfhberekum.org mail setup is untouched.
  FROM: "Holy Family Catholic Hospital <appointments@mail.hfhberekum.org>",
  // No-reply (hospital decision): no Reply-To; every email says replies
  // aren't read and gives the phone number instead.
  REPLY_TO: null,
  HOSPITAL_NAME: "Holy Family Catholic Hospital",
  HOSPITAL_TOWN: "Berekum, Ghana",
  HOSPITAL_PHONE: "024 000 0000",
  // The test project sets its own (functions/.env.telemedicine-hfch-test).
  SITE_URL: process.env.SITE_URL || "https://telemedicine.hfhberekum.org",
};

// True once FROM uses a real (verified) domain. Until then the email
// functions aren't deployed (they need the provider's API key secret) and
// bookings show "Email not set up" to admins.
settings.EMAIL_CONFIGURED = !/@example\.com/i.test(settings.FROM);

module.exports = settings;
