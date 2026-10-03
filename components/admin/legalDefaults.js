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
    lastUpdated: "30 September 2026",
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
- Booking details: consultation type, online or in-person mode, your date of birth, sex, town or city, area or nearest landmark, phone number, and the doctor you choose, if any.
- Payment details: the amount, the payment reference and whether the payment succeeded. Payment is made by mobile money through Paystack. We never see or store your mobile money PIN.
- Consultation information: what you share with your doctor during the consultation and, when the hospital has call recording switched on, a video and audio recording of online consultations (see "Consultation recording" below).
- Basic technical data needed to keep the service working and secure, such as sign-in activity.`,
      },
      {
        id: "why-we-use-it",
        title: "Why we use it",
        body: `- To set up your consultation, assign a doctor and schedule a time.
- To contact you about your appointment by phone, WhatsApp or email.
- To confirm your payment.
- To keep the platform secure and to keep a record of important actions, such as payment confirmations and schedule changes.
- To keep a short record of each consultation (doctor, date, start and end time, outcome and amount paid), which you can see in your dashboard.
- To produce statistics that help us improve the service.`,
      },
      {
        id: "who-sees-it",
        title: "Who can see your information",
        body: `Clinical details you share are visible only to the doctor handling your consultation. Hospital staff who schedule and administer consultations can see your booking details, but only what their role needs.

We use a small number of service providers to run the platform. They process information on our behalf and only for that purpose:

- Google Firebase, for sign-in, database and file storage.
- Paystack, for mobile money payments.
- A video conferencing service, for online consultations.

We do not sell your information and we do not use it for advertising.`,
      },
      {
        id: "recording",
        title: "Consultation recording",
        body: `When the hospital has call recording switched on, online video consultations are recorded (video and audio) for legal and security purposes. A REC sign shows on screen for both you and your doctor whenever a call is being recorded. Recordings are stored securely, can only be opened by authorised hospital administrators, and every time one is played, downloaded or deleted it is logged with the reason. They are never used for marketing or for any purpose unrelated to the consultation. In-person consultations are not recorded.`,
      },
      {
        id: "retention",
        title: "How long we keep it",
        body: `- The details you give when booking (date of birth, sex, location and phone number) are permanently deleted once your consultation is closed. Unpaid bookings are deleted after 24 hours.
- A short record of each consultation (doctor, date, start and end time, outcome and amount paid) is kept so you and the hospital can see your history.
- A record that you agreed to this policy, and when, is kept as proof of your consent.
- Consultation recordings are kept only as long as needed for the purposes above; authorised administrators delete them when they are no longer needed.
- Your account details are kept while your account is active. You can ask us to delete your account at any time (see "Your rights" below).`,
      },
      {
        id: "security",
        title: "How we protect it",
        body: `- Role-based access, so patients, doctors and administrators only see what they are allowed to.
- Email verification before you can book.
- Automatic sign-out after a period of inactivity, shorter for hospital staff than for patients.
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
    lastUpdated: "30 September 2026",
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

- You must be 18 or older to create an account. A parent or legal guardian may book on behalf of a child, and is responsible for the booking.
- You can choose a doctor when you book, but we cannot guarantee a particular doctor or time. Our team assigns the final doctor and time based on availability.
- Your booking is confirmed only after your payment is confirmed. Booking does not by itself create a doctor and patient relationship for treatment beyond the consultation itself.`,
      },
      {
        id: "emergencies",
        title: "Not for emergencies",
        body: `This platform is not an emergency service. If you or someone else has a life-threatening problem, such as severe bleeding, chest pain, difficulty breathing, a seizure or loss of consciousness, call your local emergency number (112 in Ghana) or go to the nearest emergency facility straight away. Do not wait for an online appointment.`,
      },
      {
        id: "medical",
        title: "Limits of an online consultation",
        body: `- A video consultation cannot replace a physical examination in every case. Your doctor may decide that you need to be seen in person, or need tests or treatment that cannot be done online.
- Give your doctor complete and accurate information about your health. Advice depends on what you tell us.
- Follow your doctor's advice, and seek in-person care if your condition gets worse.`,
      },
      {
        id: "account",
        title: "Your account",
        body: `- Provide accurate details when you sign up and when you book, and keep them up to date.
- Verify your email address before booking.
- Keep your password private. You are responsible for activity on your account, so tell us straight away if you think someone else has used it.
- We may sign you out automatically after a period of inactivity to protect your information.`,
      },
      {
        id: "booking",
        title: "Booking and scheduling",
        body: `- After you pay, our team assigns you a doctor and a time and tells you by email, and may also contact you by phone or WhatsApp.
- Keep your phone reachable and join or arrive on time. If you miss your appointment without letting us know, the hospital may treat the consultation as completed.
- You can ask to reschedule from your dashboard or by calling the hospital. Rescheduling depends on availability.
- For online consultations, you are responsible for a working internet connection, a device with a camera and microphone, and a private place to talk.`,
      },
      {
        id: "fees",
        title: "Fees and payment",
        body: `- The fee is shown before you pay. It depends on the consultation type and may be higher if you choose a specialist.
- You pay by mobile money through Paystack. We do not see or store your mobile money PIN.
- The amount charged is decided by our system, not by your browser, and your booking is only created once the payment is confirmed.
- If a payment fails, your booking is not created and you can try again. If money leaves your account but your booking does not appear, contact the hospital with your payment details and we will investigate.`,
      },
      {
        id: "refunds",
        title: "Cancellations and refunds",
        body: `- If the hospital cannot provide your consultation, for example because no doctor is available, you can reschedule or ask for a refund of the amount you paid.
- If you cancel or do not attend, the hospital decides whether a refund or a new appointment is possible, taking into account how much notice you gave.
- Approved refunds are returned to the mobile money account used for payment.`,
      },
      {
        id: "conduct",
        title: "How you may use the platform",
        body: `You agree not to:

- Give false information or pretend to be someone else.
- Book or pay using an account, phone number or mobile money account that is not yours or that you are not allowed to use.
- Be abusive, threatening or disrespectful to doctors or staff.
- Record, share or publish a consultation without the permission of everyone in it.
- Try to break, overload or gain unauthorised access to the platform or to other people's information.`,
      },
      {
        id: "privacy",
        title: "Your information and recordings",
        body: `How we collect, use, store and delete your information is explained in our [privacy policy](/privacy). That includes the video and audio recordings of online consultations made when the hospital has call recording switched on. By booking, you agree to the way we handle your information as described there.`,
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
