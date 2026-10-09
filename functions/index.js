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
const roomDevices = require("./roomDevices");
const staffAuth = require("./staffAuth");
const auditMirror = require("./auditMirror");
const noShow = require("./noShow");
const refundSync = require("./refundSync");

// Staff sign-in second factor (authenticator app for admins and doctors)
exports.confirmStaffSession = staffAuth.confirmStaffSession;
exports.resetStaffAuthenticator = staffAuth.resetStaffAuthenticator;

// Accounts
exports.registerPatient = accounts.registerPatient;
exports.updatePatientProfile = accounts.updatePatientProfile;
exports.syncAccountEmail = accounts.syncAccountEmail;
exports.updateStaffProfile = accounts.updateStaffProfile;
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
exports.reportDoctorUnavailable = consultations.reportDoctorUnavailable;
exports.callHeartbeat = consultations.callHeartbeat;

// No-shows: automatic marking after the waiting time, paid reschedule,
// closing the ones left alone (noShow.js)
exports.autoMarkNoShows = noShow.autoMarkNoShows;
exports.closeExpiredNoShows = noShow.closeExpiredNoShows;
exports.startNoShowReschedule = noShow.startNoShowReschedule;
exports.getNoShowFeeStatus = noShow.getNoShowFeeStatus;
exports.reconcilePaystack = require("./reconcile").reconcilePaystack;
exports.syncPaystackRefunds = refundSync.syncPaystackRefunds;
exports.reportCaptureAttempt = consultations.reportCaptureAttempt;

// Telemedicine room computers (doctors start calls only from these)
exports.registerRoomDevice = roomDevices.registerRoomDevice;
exports.revokeRoomDevice = roomDevices.revokeRoomDevice;

// Call recording
exports.setCallRecordingMode = recordings.setCallRecordingMode;
exports.startRecording = recordings.startRecording;
exports.finalizeRecording = recordings.finalizeRecording;
exports.requestRecordingAccess = recordings.requestRecordingAccess;
exports.decideRecordingAccess = recordings.decideRecordingAccess;
exports.getRecordingUrl = recordings.getRecordingUrl;
exports.requestRecordingDeletion = recordings.requestRecordingDeletion;
exports.decideDeletionRequest = recordings.decideDeletionRequest;
exports.recoverStaleRecordings = recordings.recoverStaleRecordings;

// Site content (admin Control Panel)
exports.updateConsultationPrices = siteSettings.updateConsultationPrices;
exports.updateNoShowPolicy = siteSettings.updateNoShowPolicy;
exports.updateSiteImages = siteSettings.updateSiteImages;
exports.updateInPersonPayment = siteSettings.updateInPersonPayment;
exports.updateHospitalServices = siteSettings.updateHospitalServices;
exports.updateDoctorSelection = siteSettings.updateDoctorSelection;
exports.updateLegalDocument = legalDocs.updateLegalDocument;

// Tamper-proof copy of the audit log (Cloud Logging -> locked bucket)
exports.mirrorAuditLog = auditMirror.mirrorAuditLog;

// Scheduled housekeeping
exports.cleanupExpiredBookings = maintenance.cleanupExpiredBookings;
exports.releaseSlotHolds = maintenance.releaseSlotHolds;
exports.cleanupSignalling = maintenance.cleanupSignalling;
exports.cleanupRateLimits = maintenance.cleanupRateLimits;

// Appointment emails and reminders to patients and doctors. Sending needs
// the RESEND_API_KEY secret, so these are only deployed once
// lib/mailConfig.js FROM uses the hospital's verified domain.
if (require("./lib/mailConfig").EMAIL_CONFIGURED) {
  const email = require("./email");
  const reminders = require("./reminders");
  exports.sendQueuedEmail = email.sendQueuedEmail;
  exports.notifyAdminsNewBooking = email.notifyAdminsNewBooking;
  exports.retryQueuedEmails = email.retryQueuedEmails;
  exports.sendAppointmentReminders = reminders.sendAppointmentReminders;
}
