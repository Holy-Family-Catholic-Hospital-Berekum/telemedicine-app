// legalDefaults.js
//
// Built-in text for the two legal pages. It is shown until an admin saves
// their own version from the Control panel (Firestore: legalDocs/{id}).
//
// Section bodies use a tiny format so admins can edit them as plain text:
//   - a blank line starts a new paragraph
//   - a line starting with "- " is a bullet
//   - [link text](/privacy) makes a link (/paths, mailto:, tel:, https:// only)
// Section numbers are added automatically when the page is drawn.

export const DEFAULT_LEGAL = {
  privacy: {
    lastUpdated: "19 October 2026",
    contactEmail: "info@hfhberekum.org",
    intro:
      "This policy explains what personal information the hospital's telemedicine platform collects, why, who sees it, and how long we keep it. We have tried to keep it short and plain.",
    sections: [
      {
        id: "who-we-are",
        title: "Who we are",
        body: `This platform is run by Holy Family Catholic Hospital, Berekum, Ghana ("the hospital", "we", "us"). It lets you book and attend General OPD and surgical consultations online or in person. The hospital is the controller of the personal information described in this policy.`,
      },
      {
        id: "what-we-collect",
        title: "What we collect",
        body: `We only collect what we need to run your consultation.

- Account details: your name, phone number and email address, and a password that is handled by our sign-in provider (we never see or store it in readable form).
- Booking details: consultation type, whether you see the doctor by video call or at the hospital, your phone number, and the doctor you choose, if any. For a video call we also ask for your age, sex, town or city and area or nearest landmark; for a visit at the hospital we don't. When you book for your child, these are your child's details, plus your child's name.
- Your confirmation that you are 18 or older, given when you create an account, and, when you book for a child, your consent as their parent or guardian.
- Payment details: the amount, the payment reference and whether the payment succeeded, and for refunds, the amount and its progress. Payment is made by mobile money through Paystack, and refunds go back through Paystack to the wallet you paid from. We never see or store your mobile money PIN.
- Prescriptions: when your doctor writes one after a video consultation, the medicines and how to take them, with the name, age and sex printed on it.
- Consultation information: what you share with your doctor during the consultation and, when the hospital has call recording switched on, a recording of online consultations (video with sound, or sound only) (see "Consultation recording" below).
- Support messages: what you write to our support team with the Help button, which booking it is about if you choose one, and our replies.
- Basic technical data needed to keep the service working and secure, such as sign-in activity (including the type of device and browser you sign in from, so we can email you when your account is used on a new one), and any attempt the call screen detects to take a screenshot of or record a video consultation.`,
      },
      {
        id: "children",
        title: "Children",
        body: `Accounts are for adults: when you sign up, you confirm that you are 18 or older. A child under 18 is booked by their parent or legal guardian, from the parent's or guardian's own account. In line with Ghana's Data Protection Act, 2012 (Act 843), we only use a child's information with that parent's or guardian's consent, which they give on the booking form and which we record (with the date and time). The child's details are handled exactly like an adult's: they are deleted when the consultation is closed. The parent or guardian can use the rights described below on the child's behalf.`,
      },
      {
        id: "why-we-use-it",
        title: "Why we use it",
        body: `- To set up your consultation, assign a doctor and schedule a time.
- To contact you about your appointment by phone, WhatsApp or email.
- To answer your support messages: in the app, and by email with a copy of our reply.
- To confirm your payment.
- To keep the platform secure and to keep a record of important actions, such as payment confirmations and schedule changes.
- To keep a short record of each consultation (doctor, date, start and end time, outcome and amount paid), which you can see in your dashboard.
- To produce statistics that help us improve the service.`,
      },
      {
        id: "who-sees-it",
        title: "Who can see your information",
        body: `Clinical details you share are visible only to the doctor handling your consultation. A prescription can be seen only by you and the doctor who wrote it; anyone holding the code printed on it (such as your pharmacist) can check online that it is genuine and see the doctor, the dates and the medicines, but not your name. Hospital staff who schedule and administer consultations can see your booking details, but only what their role needs. Support messages are read only by the hospital's administrators, not by doctors.

We use a small number of service providers to run the platform. They process information on our behalf and only for that purpose:

- Google (Firebase and Google Cloud), for sign-in, our database, file storage (including consultation recordings), the servers that run the service and hosting the website.
- Brevo, which sends our emails (your email address, name, appointment details and our replies to your support messages).
- Cloudflare, which relays a video call when your device can't connect directly to the doctor's. The call stays encrypted and is not stored.
- Paystack, for mobile money payments.

When you create an account or sign in, your browser checks that your password isn't on a public list of passwords leaked from other websites (Have I Been Pwned). Your password is never sent: only the first 5 characters of a scrambled version of it, which cannot be turned back into your password.

Where your information is kept: our database, files and servers are in the European Union (Belgium and the Netherlands), and the other providers above may process information in other countries. This means your information is stored and processed outside Ghana. We use these providers only to run this service, and they protect it with encryption and access controls.

We do not sell your information and we do not use it for advertising.`,
      },
      {
        id: "recording",
        title: "Consultation recording",
        body: `When the hospital has call recording switched on, online video consultations are recorded (video with sound, or sound only, as the hospital chooses) for legal and security purposes. A REC sign shows on screen for both you and your doctor whenever a call is being recorded. Recordings are stored securely and can only be opened by authorised hospital administrators. No single administrator can play, download or delete a recording: each request needs a second administrator's approval, and every step is logged with both names and the reason. They are never used for marketing or for any purpose unrelated to the consultation. In-person consultations are not recorded.`,
      },
      {
        id: "retention",
        title: "How long we keep it",
        body: `- The details you give when booking (phone number and, for a video call, age, sex and location) are permanently deleted once your consultation is closed. If a consultation is marked as missed, they are kept for up to 14 days so you can book a new time or ask for a refund, then deleted when it closes. Unpaid bookings are deleted after 24 hours.
- To protect against data loss, we keep encrypted backups of our database for 7 days. Information deleted from the platform can remain in these backups until they expire, at most 7 days later, and is only used to restore the service after a fault.
- A short record of each consultation (doctor, date, start and end time, outcome and amount paid) is kept so you and the hospital can see your history.
- Prescriptions are deleted 7 days after your doctor writes them, so download yours before then. We keep only a note that a prescription was written and when, without the medicines. Your doctor records your consultation in the hospital's patient records system, as for a visit at the hospital.
- Support messages are deleted 30 days after the conversation is closed (you can close it yourself, and we close an answered one after 7 days without a reply from you). The emails we send you are deleted from our system after 30 days.
- A record that you agreed to this policy, and when, is kept as proof of your consent.
- Consultation recordings are kept only as long as needed for the purposes above; authorised administrators delete them when they are no longer needed.
- Your account details are kept while your account is active. You can ask us to delete your account at any time (see "Your rights" below).`,
      },
      {
        id: "security",
        title: "How we protect it",
        body: `- Role-based access, so patients, doctors and administrators only see what they are allowed to.
- Hospital staff sign in with a password and a code from an authenticator app on their own phone.
- Playing, downloading or deleting a consultation recording needs two administrators: one to ask and another to approve.
- Email verification before you can book.
- Automatic sign-out after an hour of inactivity (30 minutes for hospital staff, also enforced on our servers).
- Doctors hold online consultations only from the hospital's telemedicine room.
- During a video consultation, your name and the time are shown across the other person's video and move around the picture, so any screenshot or recording shows who made it; the video is hidden while you are in another app or window; and screenshot attempts the call screen detects are logged. A website cannot fully prevent screenshots or screen recording, so please respect your consultation's privacy and your doctor's.
- Payments handled entirely by Paystack, not on our servers.

No online service can promise perfect security, but we work to keep your information protected and limit who can see it.`,
      },
      {
        id: "your-rights",
        title: "Your rights",
        body: `Under Ghana's Data Protection Act, 2012 (Act 843), you can ask us to:

- Tell you what personal information we hold about you and give you a copy.
- Correct information that is wrong or out of date.
- Delete your information, where we no longer need it.
- Stop using your information in a particular way.

If you are not happy with how we handle your information, you can complain to Ghana's Data Protection Commission.`,
      },
      {
        id: "changes",
        title: "Changes to this policy",
        body: `If we change how we handle your information, we will update this page and the date at the top. If a change is significant, we will tell you before it takes effect.`,
      },
    ],
  },

  terms: {
    lastUpdated: "19 October 2026",
    contactEmail: "info@hfhberekum.org",
    intro:
      "These terms explain the rules for using the hospital's telemedicine platform to book and attend consultations. Please read them before you book.",
    sections: [
      {
        id: "agreement",
        title: "Agreeing to these terms",
        body: `These terms are between you and Holy Family Catholic Hospital, Berekum, Ghana ("the hospital", "we", "us"). By creating an account, booking a consultation or using this platform, you agree to them. If you do not agree, please do not use the platform. You can still call or visit the hospital.`,
      },
      {
        id: "the-service",
        title: "What the service is",
        body: `The platform lets you book and pay for General OPD and surgical consultations with the hospital's doctors, online by video or in person at the hospital.

- You must be 18 or older to create an account, and you confirm this when you sign up.
- A parent or legal guardian may book for a child under 18 from their own account. When booking, they confirm they are the child's parent or guardian and give consent for the child's information to be used for the consultation. They are responsible for the booking, and they or another responsible adult should be with the child during the consultation.
- You can choose a doctor when you book, but we cannot guarantee a particular doctor or time. Our team assigns the final doctor and time based on availability.
- Doctors hold online consultations from the hospital's dedicated telemedicine room.
- Your booking is confirmed only after your payment is confirmed. Booking does not by itself create a doctor and patient relationship for treatment beyond the consultation itself.`,
      },
      {
        id: "emergencies",
        title: "Not for emergencies",
        body: `This platform is not an emergency service. If you or someone else has a life-threatening problem, such as severe bleeding, chest pain, difficulty breathing, a seizure or loss of consciousness, call your local emergency number (112 in Ghana) or go to the nearest emergency facility straight away. Do not wait for an online appointment.

Messages to our support team (the Help button) are for help with bookings, payments, video calls and your account, not for medical advice. We answer them Monday to Friday, 8:00 am to 5:00 pm (Ghana time); a message sent outside those hours is answered when we next open.`,
      },
      {
        id: "medical",
        title: "Limits of an online consultation",
        body: `- A video consultation cannot replace a physical examination in every case. Your doctor may decide that you need to be seen in person, or need tests or treatment that cannot be done online.
- Give your doctor complete and accurate information about your health. Advice depends on what you tell us.
- Follow your doctor's advice, and seek in-person care if your condition gets worse.
- After a video consultation, your doctor may write you a prescription. You can download it from your dashboard and take it to a pharmacy; it is valid for 7 days from the day it was written, and after that it is deleted. Your doctor may cancel a prescription (for example, to correct it); a cancelled prescription must not be used. For visits at the hospital, prescriptions are given at the hospital.`,
      },
      {
        id: "account",
        title: "Your account",
        body: `- Provide accurate details when you sign up and when you book, and keep them up to date.
- Confirm your email address (tap the link in the email we send you) before booking.
- You can change your name and email address in Settings on your dashboard. A new email address takes effect once you confirm it from the link we send to it.
- Keep your password private. You are responsible for activity on your account, so tell us straight away if you think someone else has used it.
- We may sign you out automatically after a period of inactivity to protect your information.`,
      },
      {
        id: "booking",
        title: "Booking and scheduling",
        body: `- After you pay, our team assigns you a doctor and a time and tells you by email, and may also contact you by phone or WhatsApp.
- We send email reminders about a day and about an hour before your appointment. For an online consultation, we also email you if the start time has passed and you have not joined the call yet.
- Keep your phone reachable and join or arrive on time. You can join the video call from 30 minutes before your appointment until 4 hours after the start time.
- You can ask to reschedule from your dashboard or by calling the hospital before your appointment. Rescheduling depends on availability, and is free up to 24 hours before your appointment (see "Cancellations and refunds").
- Missed appointments (no-shows): for a video consultation, whoever is in the video room first waits a short time for the other, counted from the start time or from when they joined if that is later. If your doctor is waiting and you are not in the call by then, the consultation is marked as missed; leaving the call before your doctor arrives does not count as attending, and you are told when your doctor joins so you can come back. If nobody has joined by the end of the waiting time after the start, or your doctor does not join in time, it counts as your doctor missing the appointment. Once you and your doctor have been connected in the call, the consultation has taken place. The waiting time is shown on your dashboard and in your appointment emails. If you have not joined (or, for an in-person visit, arrived) by then, the consultation is marked as missed. For online consultations this happens automatically. See "Cancellations and refunds" for what you can do next.
- For online consultations, you are responsible for a working internet connection, a device with a camera and microphone, and a private place to talk.`,
      },
      {
        id: "fees",
        title: "Fees and payment",
        body: `- The fee is shown before you pay. It depends only on whether you see the doctor by video call or at the hospital. General OPD and surgical consultations cost the same, whichever doctor you choose.
- You pay by mobile money through Paystack. We do not see or store your mobile money PIN.
- We only take payment on this website (through Paystack) or at the hospital itself. Fees for rescheduling or a missed appointment are paid the same way, from your dashboard. We will never call, text or WhatsApp you to ask you to send money to a phone number or account, and we will never ask for your mobile money PIN, your password or a code sent to your phone, including to give you a refund (refunds go back automatically to the wallet you paid from). If anyone does, it is a scam: do not pay, and tell the hospital.
- For a visit at the hospital, the hospital may let you book without paying online. Then you pay the fee at the hospital when you come, and you can have one such visit booked at a time (one per account and one per phone number). A missed visit of this kind has no fee and nothing to refund; you can simply book again.
- The amount charged is decided by our system, not by your browser, and your booking is only created once the payment is confirmed.
- If a payment fails, your booking is not created and you can try again. If money leaves your account but your booking does not appear, contact the hospital with your payment details and we will investigate.`,
      },
      {
        id: "refunds",
        title: "Cancellations and refunds",
        body: `- If you cannot attend a scheduled appointment, reschedule it from your dashboard. This is free up to 24 hours before the appointment. Less than 24 hours before, rescheduling costs an extra fee set by the hospital (the same amount as the no-show fee below), shown before you pay and paid by mobile money; your appointment stays booked until the fee is paid. If you were given a time less than 24 hours before it starts, you can change it free of charge within an hour of being given it (your appointment email says until when). Rescheduling is always free if your doctor could not make your appointment or your video consultation could not be completed. Visits at the hospital that you pay for at the hospital can be rescheduled free of charge.
- Once the appointment time has started, asking to reschedule (without having joined) counts as a missed appointment, and the no-show fee below applies. This does not apply if your doctor has not joined an online consultation within the waiting time.
- If your consultation is marked as missed (a no-show), you can, within 14 days: book a new time by paying an extra no-show fee, or ask for a refund of what you paid minus a share the hospital keeps for the missed appointment. The fee and the share kept are set by the hospital; the amounts that apply to you are fixed when the consultation is marked as missed and are shown on your dashboard and in the email we send you. If you do neither within 14 days, the booking is closed without a refund.
- You can only ask for a refund for a scheduled appointment that you did not attend. For an online consultation, that means you never joined the video call. Once you have joined a consultation, it cannot be refunded. If a consultation was not marked as missed and was not held, you can ask for a refund from your dashboard once the day of your appointment has passed.
- If your doctor cannot make your appointment, we tell you by email. This includes a video call your doctor has not joined within the same waiting time that applies to you, even if you had not joined either. We then give you a new time at no extra cost, or, if you prefer, you can ask for a full refund from your dashboard straight away, even if you had joined the call and waited.
- Each consultation can be either rescheduled or refunded, not both.
- If your doctor could not join your online consultation, you can reschedule it at no extra cost. If you need help, call the hospital.
- The hospital reviews each refund request. Approved refunds are sent through Paystack back to the mobile money wallet you paid from; it can take a few working days to arrive.
- If you are charged twice for the same booking, or your payment arrives after your booking has expired, the payment we cannot use is refunded to you in full automatically.
- If your account is deleted, we refund automatically what you could have asked for: in full for an appointment you have not had yet, or that your doctor could not make; for a missed appointment, what you paid minus the share the hospital keeps. No-show fees and late reschedule fees are not refunded, because they pay for an appointment time that was lost.`,
      },
      {
        id: "conduct",
        title: "How you may use the platform",
        body: `You agree not to:

- Give false information or pretend to be someone else.
- Book or pay using an account, phone number or mobile money account that is not yours or that you are not allowed to use.
- Be abusive, threatening or disrespectful to doctors or staff.
- Take screenshots of, record, share or publish a consultation. Only the hospital's own recording, described in the privacy policy, is allowed. The call screen shows your name and the time across the video, and screenshot attempts it detects are logged and may lead to your account being suspended.
- Try to break, overload or gain unauthorised access to the platform or to other people's information.`,
      },
      {
        id: "privacy",
        title: "Your information and recordings",
        body: `How we collect, use, store and delete your information is explained in our [privacy policy](/privacy). That includes the recordings (video or sound only) of online consultations made when the hospital has call recording switched on. By booking, you agree to the way we handle your information as described there.`,
      },
      {
        id: "availability",
        title: "Availability",
        body: `We work to keep the platform running, but it may sometimes be unavailable because of maintenance, faults, or problems with the internet or mobile networks that we do not control. If a technical problem stops your consultation from going ahead, we will help you reschedule.`,
      },
      {
        id: "liability",
        title: "Our responsibility",
        body: `We take reasonable care in providing the service. Nothing in these terms limits any right you have under Ghanaian law that cannot be limited, including our responsibility for the quality of medical care. Apart from that, the hospital is not responsible for losses caused by things outside our reasonable control, such as network or power failures, or by information you gave us that was wrong or incomplete.`,
      },
      {
        id: "suspension",
        title: "Suspending accounts",
        body: `We may suspend or close an account if these terms are broken, if we suspect fraud or misuse, or to protect patients and staff. You can also ask us to close your account at any time.`,
      },
      {
        id: "changes",
        title: "Changes to these terms",
        body: `We may update these terms from time to time. We will change the date at the top of this page, and tell you before a significant change takes effect. If you keep using the platform after that, you accept the updated terms.`,
      },
      {
        id: "law",
        title: "Governing law",
        body: `These terms are governed by the laws of Ghana. If we cannot resolve a disagreement together, it can be taken to the courts of Ghana.`,
      },
    ],
  },
};
