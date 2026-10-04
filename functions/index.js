/**
 * functions/index.js
 *
 * Every deployed Cloud Function, listed by name. Only what is exported here
 * is deployed, so a function missing from this list does not exist.
 *
 * All functions run in europe-west1 (lib/core.js, inside Firestore's eur3
 * location). The browser is untrusted: role comes from the `role` custom
 * claim, every write to bookings, consultations, payments, recordings,
 * consents and the audit log happens here, and Security Rules deny those
 * writes to clients.
 *
 * Secrets (never committed):
 *   firebase functions:secrets:set PAYSTACK_SECRET_KEY
 *   firebase functions:secrets:set CLOUDFLARE_TURN_KEY_ID
 *   firebase functions:secrets:set CLOUDFLARE_TURN_API_TOKEN
 */

require("./lib/core"); // initializeApp + region, before anything else

const accounts = require("./accounts");
const payments = require("./payments");
const scheduling = require("./scheduling");
const consultations = require("./consultations");
const recordings = require("./recordings");
const maintenance = require("./maintenance");
const siteSettings = require("./siteSettings");
const legalDocs = require("./legalDocs");
const refunds = require("./refunds");

// Accounts
exports.registerPatient = accounts.registerPatient;
exports.createDoctorAccount = accounts.createDoctorAccount;
exports.setAccountStatus = accounts.setAccountStatus;

// Booking and payment
exports.createBookingDraft = payments.createBookingDraft;
exports.initializePayment = payments.initializePayment;
exports.paystackWebhook = payments.paystackWebhook;
exports.getBookingStatus = payments.getBookingStatus;
exports.resolvePaymentIssue = payments.resolvePaymentIssue;
exports.requestRefund = refunds.requestRefund;
exports.resolveRefundRequest = refunds.resolveRefundRequest;

// Scheduling
exports.scheduleConsultation = scheduling.scheduleConsultation;
exports.createAvailableSlot = scheduling.createAvailableSlot;
exports.cancelAvailableSlot = scheduling.cancelAvailableSlot;
exports.requestReschedule = scheduling.requestReschedule;
exports.rescheduleConsultation = scheduling.rescheduleConsultation;

// Video consultations
exports.startVideoCall = consultations.startVideoCall;
exports.getTurnCredentials = consultations.getTurnCredentials;
exports.markConsultationDone = consultations.markConsultationDone;

// Call recording
exports.setCallRecordingMode = recordings.setCallRecordingMode;
exports.startRecording = recordings.startRecording;
exports.finalizeRecording = recordings.finalizeRecording;
exports.getRecordingUrl = recordings.getRecordingUrl;
exports.deleteRecording = recordings.deleteRecording;
exports.deleteRecordingsBefore = recordings.deleteRecordingsBefore;
exports.recoverStaleRecordings = recordings.recoverStaleRecordings;

// Site content (admin Control Panel)
exports.updateConsultationPrices = siteSettings.updateConsultationPrices;
exports.updateSiteImages = siteSettings.updateSiteImages;
exports.updateDoctorSelection = siteSettings.updateDoctorSelection;
exports.updateLegalDocument = legalDocs.updateLegalDocument;

// Scheduled housekeeping
exports.cleanupExpiredBookings = maintenance.cleanupExpiredBookings;
exports.releaseSlotHolds = maintenance.releaseSlotHolds;
exports.cleanupSignalling = maintenance.cleanupSignalling;
exports.cleanupRateLimits = maintenance.cleanupRateLimits;

// Patient emails. They need the RESEND_API_KEY secret, so they're only
// deployed once lib/mailConfig.js FROM uses the hospital's verified domain.
if (require("./lib/mailConfig").EMAIL_CONFIGURED) {
  const email = require("./email");
  exports.sendQueuedEmail = email.sendQueuedEmail;
  exports.retryQueuedEmails = email.retryQueuedEmails;
}
