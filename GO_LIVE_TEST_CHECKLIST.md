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
- [ ] Admin receives the "New booking" email.
- [ ] Close the Paystack window without paying: no booking appears, and a
      new booking is allowed afterwards.

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
- [ ] Doctor's "Call couldn't be completed": the patient's card says "Your
      consultation couldn't be completed" (not "doctor can't make it"); the
      admin can give it a new time.

## 5. After a no-show

- [ ] Patient pays the no-show fee: booking becomes a reschedule request.
- [ ] Patient asks for a refund instead: request appears for the admin;
      "Approve & refund" sends it; Revenue → Refunds shows it once Paystack
      confirms.

## 6. Admin

- [ ] Bookings, History, Users, Revenue, Audit and Metrics load.
- [ ] Recordings: play a recording (needs a second admin to approve).
- [ ] Users: patients and doctors show Deactivate / Reactivate and no
      Delete button.
- [ ] Delete a test patient in the Firebase console; after the next daily
      run their bookings disappear and any unused payment shows under
      Payment issues as "Patient account deleted before the consultation".
- [ ] Control panel → Legal: the privacy policy shows the current wording
      (see SECURITY_SETUP.md, "Publish the current privacy policy").

## 7. Phones and weak connections

- [ ] Android: the "Add the app to your phone" popup appears on the
      dashboard; adding works; the icon and name "Holy Family" look right.
- [ ] iPhone: the popup shows the Share → Add to Home Screen steps.
- [ ] Airplane mode, then open the installed app: "You're offline" (never
      a white screen); it reloads by itself when the connection is back.
- [ ] On a slow connection the "Your connection is slow" bar appears.

## 8. After the pass

- [ ] No unexpected "Telemedicine function errors" alert emails.
- [ ] Clear the test data (SECURITY_SETUP.md, "Payments go-live checklist").
