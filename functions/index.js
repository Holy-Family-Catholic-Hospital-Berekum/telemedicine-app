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
const prescriptions = require("./prescriptions");

// Staff sign-in second factor (authenticator app for admins and doctors)
exports.confirmStaffSession = staffAuth.confirmStaffSession;
exports.staffActivity = staffAuth.staffActivity;
exports.resetStaffAuthenticator = staffAuth.resetStaffAuthenticator;

// Accounts
exports.registerPatient = accounts.registerPatient;
exports.noteSignIn = accounts.noteSignIn;
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

// Prescriptions after a video consultation (7 days; the record is LHIMS)
exports.updatePrescriberDetails = prescriptions.updatePrescriberDetails;
exports.issuePrescription = prescriptions.issuePrescription;
exports.cancelPrescription = prescriptions.cancelPrescription;
exports.getPrescriptionPdf = prescriptions.getPrescriptionPdf;
exports.checkPrescription = prescriptions.checkPrescription;

// No-shows: automatic marking after the waiting time, paid reschedule,
// closing the ones left alone (noShow.js)
exports.startNoShowReschedule = noShow.startNoShowReschedule;
exports.getNoShowFeeStatus = noShow.getNoShowFeeStatus;
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

// Site content (admin Control Panel)
exports.updateConsultationPrices = siteSettings.updateConsultationPrices;
exports.updateNoShowPolicy = siteSettings.updateNoShowPolicy;
exports.updateSiteImages = siteSettings.updateSiteImages;
exports.updateInPersonPayment = siteSettings.updateInPersonPayment;
exports.updateHospitalServices = siteSettings.updateHospitalServices;
exports.updateDoctorSelection = siteSettings.updateDoctorSelection;
exports.updateLegalDocument = legalDocs.updateLegalDocument;
// Admin metrics report (Metrics & reports tab: CSV / PDF export)
const reports = require("./reports");
exports.exportMetrics = reports.exportMetrics;
exports.cancelReportRequest = reports.cancelReportRequest;
exports.decideReportRequest = reports.decideReportRequest;
exports.downloadReport = reports.downloadReport;

// Errors in visitors' browsers -> Cloud Logging "CLIENT_ERROR" (alerted)
exports.reportClientError = require("./clientErrors").reportClientError;

// Tamper-proof copy of the audit log (Cloud Logging -> locked bucket)
exports.mirrorAuditLog = auditMirror.mirrorAuditLog;

// Background tasks (lib/task.js), run by three scheduled jobs (jobs.js):
// every minute, every 15 minutes and daily. Left out where
// SCHEDULED_JOBS=off: the test project (functions/.env.telemedicine-hfch-test),
// so it costs nothing; their logic is covered by the automated tests.
const SCHEDULED = process.env.SCHEDULED_JOBS !== "off";
const TASKS = [
  // No-shows and "doctor didn't join" after the waiting time; closing held
  // no-shows (noShow.js)
  noShow.autoMarkNoShows,
  noShow.closeExpiredNoShows,
  // Payments: nightly reconciliation, following refunds
  require("./reconcile").reconcilePaystack,
  refundSync.syncPaystackRefunds,
  // Recordings left unfinished
  recordings.recoverStaleRecordings,
  // Housekeeping
  maintenance.cleanupExpiredBookings,
  maintenance.releaseSlotHolds,
  maintenance.cleanupSignalling,
  maintenance.cleanupRateLimits,
  // Prescriptions past their 7 days
  prescriptions.deleteExpiredPrescriptions,
  // Metrics report data nobody downloaded
  reports.cleanupReportData,
];

// Appointment emails and reminders to patients and doctors. Sending needs
// the mail provider's API key (lib/mailProvider.js), so these are only deployed once
// lib/mailConfig.js FROM uses the hospital's verified domain.
if (require("./lib/mailConfig").EMAIL_CONFIGURED) {
  const email = require("./email");
  const reminders = require("./reminders");
  exports.sendQueuedEmail = email.sendQueuedEmail;
  exports.notifyAdminsNewBooking = email.notifyAdminsNewBooking;
  TASKS.push(email.retryQueuedEmails, reminders.sendAppointmentReminders);
}

if (SCHEDULED) Object.assign(exports, require("./jobs").scheduledJobs(TASKS));
