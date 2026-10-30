# Go-live test checklist

One full pass on the live site (https://telemedicine.hfhberekum.org) before
real patients use it, and again after any big change. Two people, three
devices:

- **Patient:** an Android phone (Chrome) and, if possible, an iPhone
  (Safari), signed in as a test patient.
- **Doctor:** the registered telemedicine room computer, signed in as a
  doctor.
- **Admin:** any computer, signed in as an admin.

Set the video-call waiting time to 5 minutes in Control panel → No-show
policy before you start (the times below assume 5). Tick each box; if a
step fails, note what you saw and the time.

## 1. Sign-up and sign-in

- [ ] Patient signs up with a new email: adult declaration asked, sign-up
      works (reCAPTCHA runs invisibly; no error).
- [ ] Sign-up with a well-known leaked password (e.g. `Password123!`) is
      refused and asks for another one.
- [ ] Sign in as the patient on a second browser or phone: "New sign-in"
      email arrives (not for the very first browser). Same for a doctor on
      a new computer (email without a link).
- [ ] Reload the dashboard and close and reopen the browser ("Remember
      me" ticked): the patient stays signed in, appointments load, and no
      second "New sign-in" email comes.
- [ ] Verification email arrives; until it's verified, booking is refused.
- [ ] Patient signs in; "Remember me" keeps them signed in after closing
      the browser, unticked it doesn't.
- [ ] Wrong password shows the same message as an unknown email.
- [ ] "Forgot password" email arrives and the reset works.
- [ ] Doctor and admin sign in on the staff page with password + authenticator
      code. A patient account on the staff page is refused like a wrong
      password.
- [ ] Staff: leave the portal untouched for 30 minutes → signed out.

## 2. Booking and payment (test money until go-live)

- [ ] Book a **video call** for yourself: age, sex, location and phone
      asked; consent shown; Paystack opens; pay; booking shows "Payment
      confirmed".
- [ ] Book for **your child**: under-18 age accepted, 18+ refused; for a
      child under 2 the months box appears; guardian consent asked.
- [ ] Book a **hospital visit**: no age/sex/location asked.
- [ ] Control panel → Payment for hospital visits off: a hospital visit is
      booked at once without Paystack ("pay at the hospital"); a second one
      is refused while the first is open, also from another account with the
      same phone number. Switch it back afterwards.
- [ ] The payment step, the footer, the WhatsApp panel and the booking
      emails all carry the warning that the hospital never asks for money
      or a PIN by call, text or WhatsApp.
- [ ] Admin receives the "New booking" email.
- [ ] Signed out, the floating button opens WhatsApp. Signed in, "Help"
      sends a message (link a booking); admins get the "New message to
      support" email (no name, no text) and see it under Customer support.
      Reply: the patient gets the reply email, and the button shows a badge
      and "Support has replied to you" on every patient page until read.
      Outside Mon–Fri 8 am–5 pm the patient also gets the "we'll reply when
      we open" email (once per closed period).
- [ ] Close the Paystack window without paying: no booking appears, and a
      new booking is allowed afterwards.
- [ ] Two patients pick the same open time on the home page: the time
      stays on the home page while they fill in the form; whoever pays first
      gets it, and the other is told "someone has just booked this
      appointment time" before Paystack opens.

## 3. Scheduling

- [ ] Admin schedules the video booking for ~10 minutes ahead: patient and
      doctor both get emails; patient dashboard shows the doctor and time.
- [ ] Admin reschedules it: both get the new-time email.
- [ ] Booking from an open slot on the home page works.

## 4. Video calls (the main event)

- [ ] Patient: from 30 minutes before, "Join call" appears; the camera and
      microphone check shows your picture and a moving mic bar.
- [ ] First join asks for the video-consultation consent; later joins don't.
- [ ] **Patient joins first:** the patient's screen shows "Your doctor has
      until HH:MM to join" with a countdown; the doctor's card shows "The
      patient is waiting".
- [ ] Doctor joins from the room computer: video and sound both ways;
      countdowns disappear; admin overview shows 1 "Consultation in
      progress".
- [ ] REC sign shows if recording is on.
- [ ] Patient leaves the window / switches app: their video is hidden and
      shows "away" until they come back. Watermark with name and time
      moves around.
- [ ] During the call (once connected), the doctor taps **Prescription**
      on the call screen (needs the MDC number and signature from the
      Account tab first): the form opens on the right with the patient
      still visible; add a medicine, check it, **Sign and issue**: the call
      screen shows "Prescription issued". (Also possible after the call
      from the card's **Write prescription**, before Mark done.)
- [ ] Patient dashboard shows "Your prescriptions"; **Download PDF** gives
      the hospital form with logo, doctor's name, MDC number, signature and
      QR code. Scanning the QR on another phone opens the check page:
      "Valid prescription" with the same medicines and no patient name.
- [ ] A prescription with the maximum 10 medicines, long instructions and
      a note with line breaks: if it doesn't fit, the PDF continues on a
      second page with the headings and booking reference repeated; the
      note keeps its lines.
- [ ] Doctor → Prescriptions → **Cancel**: the patient sees "cancelled",
      can't download it, and the check page says "Cancelled by the doctor".
- [ ] Doctor taps **Mark done → Close as completed**: booking moves to
      history; the prescription stays on the patient's dashboard.

Repeat with a new booking for each case:

- [ ] **Nobody joins:** at start + 5 minutes it becomes the doctor's
      no-show; patient email "Your doctor can't make your consultation";
      admins emailed; booking under Reschedule requests (not Scheduled).
- [ ] **Doctor waits, patient never joins:** at the deadline the patient is
      marked a no-show; patient email with the fee and refund options; the
      doctor's screen says so.
- [ ] **Patient joins, leaves, doctor joins later:** patient dashboard shows
      "Your doctor is in the call. Join before…"; rejoining in time works.
- [ ] **Patient waits, doctor never comes:** the patient's call ends with
      "Your doctor couldn't make it. We're sorry."
- [ ] **Call drops after connecting:** both can rejoin; the doctor's "Call
      couldn't be completed" gives the patient a free new time or a full
      refund.
- [ ] **Doctor's "I can't make it"** before the call: patient and admins
      emailed; appointment leaves the doctor's list.

## 4b. Changing the time

- [ ] More than 24 hours before: "Change appointment time" sends a free
      request (admin Bookings → Reschedule requests).
- [ ] Less than 24 hours before: the button shows the fee; paying it sends
      the request ("late fee paid" on the admin's request); closing the
      payment window leaves the appointment as it was.
- [ ] Admin gives that request a new time less than 24 hours ahead: the
      email says it can be changed free until a time one hour later; a
      change in that hour is free, after it the fee applies again (a
      second late change is charged again).
- [ ] Doctor's "Call couldn't be completed": the patient's card says "Your
      consultation couldn't be completed" (not "doctor can't make it"); the
      patient can send a preferred time; the admin can give it a new time.
- [ ] A missed appointment, or one the doctor can't make, shows no
      "Your consultation is live / Rejoin call" banner on the dashboard.

## 5. After a no-show

- [ ] Patient pays the no-show fee: booking becomes a reschedule request.
- [ ] Admin gives it a new time and the patient misses that one too: a new
      no-show fee is asked for (the first one doesn't count again).
- [ ] Patient asks for a refund instead: request appears for the admin;
      "Approve & refund" sends it; Revenue → Refunds shows it once Paystack
      confirms.

## 6. Admin

- [ ] Bookings, History, Users, Revenue, Audit and Metrics load.
- [ ] Recordings: play a recording (needs a second admin to approve).
- [ ] Users: patients and doctors show Deactivate / Reactivate and no
      Delete button.
- [ ] Delete a test patient in the Firebase console; after the next daily
      run their bookings disappear and Payment issues shows "Patient account
      deleted: refund…": in full for an appointment not had yet, minus the
      no-show share for a missed one; no-show and late fees aren't refunded.
- [ ] Control panel → Legal: the privacy policy shows the current wording
      (see SECURITY_SETUP.md, "Publish the current privacy policy").

## 7. Website address

- [ ] https://telemedicine-hfch.web.app and
      https://telemedicine-hfch.firebaseapp.com open the hospital address
      (https://telemedicine.hfhberekum.org) instead.
- [ ] The padlock shows a valid certificate on the hospital address.
- [ ] The test site (https://telemedicine-hfch-test.web.app) shows
      `Disallow: /` in `/robots.txt`.

## 8. Phones and weak connections

- [ ] Android: the "Add the app to your phone" popup appears on the
      dashboard; adding works; the icon and name "Holy Family" look right.
- [ ] iPhone: the popup shows the Share → Add to Home Screen steps.
- [ ] Airplane mode, then open the installed app: "You're offline" (never
      a white screen); it reloads by itself when the connection is back.
- [ ] On a slow connection the "Your connection is slow" bar appears.

## 9. After the pass

- [ ] No unexpected "Telemedicine function errors" alert emails.
- [ ] Clear the test data (SECURITY_SETUP.md, "Payments go-live checklist").
