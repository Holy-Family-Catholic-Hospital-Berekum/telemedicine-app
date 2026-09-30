import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/authContext.jsx";
import HealthcarePreloader from "../components/common/healthcarePreloader.jsx";
import Header from "../../components/shared/header";
import Footer from "../../components/shared/footer";
import { HOSPITAL_PHONE_TEL } from "../../components/shared/contact";

/**
 * terms.jsx
 * Public terms of service, lives at "/terms".
 *
 * BEFORE LAUNCH, confirm these with the hospital. They are business
 * decisions the code cannot tell us, and the wording below is a
 * reasonable default, not a commitment the hospital has made:
 *   - Section 6 and 8: refund and rescheduling rules (what happens when
 *     no doctor is available, when a patient cancels, or when a patient
 *     misses an appointment).
 *   - Section 2: the 18+ rule and whether parents or guardians may book
 *     for a child.
 *   - Section 3: that 112 is the right emergency number to show.
 *   - TERMS_EMAIL: a real, monitored address.
 * Have the hospital's legal or compliance lead review the final text.
 */

const LAST_UPDATED = "30 September 2026";
const TERMS_EMAIL = "info@example.com"; // TODO: replace with the real address

const sections = [
  {
    id: "agreement",
    title: "1. Agreeing to these terms",
    blocks: [
      {
        type: "p",
        text: 'These terms are between you and Holy Family Catholic Hospital, Berekum, Ghana ("the hospital", "we", "us"). By creating an account, booking a consultation or using this platform, you agree to them. If you do not agree, please do not use the platform. You can still call or visit the hospital.',
      },
    ],
  },
  {
    id: "the-service",
    title: "2. What the service is",
    blocks: [
      {
        type: "p",
        text: "The platform lets you book and pay for General OPD and surgical consultations with the hospital's doctors, online by video or in person at the hospital.",
      },
      {
        type: "ul",
        items: [
          "You must be 18 or older to create an account. A parent or legal guardian may book on behalf of a child, and is responsible for the booking.",
          "You can choose a doctor when you book, but we cannot guarantee a particular doctor or time. Our team assigns the final doctor and time based on availability.",
          "Your booking is confirmed only after your payment is confirmed. Booking does not by itself create a doctor and patient relationship for treatment beyond the consultation itself.",
        ],
      },
    ],
  },
  {
    id: "emergencies",
    title: "3. Not for emergencies",
    blocks: [
      {
        type: "p",
        text: "This platform is not an emergency service. If you or someone else has a life-threatening problem, such as severe bleeding, chest pain, difficulty breathing, a seizure or loss of consciousness, call your local emergency number (112 in Ghana) or go to the nearest emergency facility straight away. Do not wait for an online appointment.",
      },
    ],
  },
  {
    id: "medical",
    title: "4. Limits of an online consultation",
    blocks: [
      {
        type: "ul",
        items: [
          "A video consultation cannot replace a physical examination in every case. Your doctor may decide that you need to be seen in person, or need tests or treatment that cannot be done online.",
          "Give your doctor complete and accurate information about your health. Advice depends on what you tell us.",
          "Follow your doctor's advice, and seek in-person care if your condition gets worse.",
        ],
      },
    ],
  },
  {
    id: "account",
    title: "5. Your account",
    blocks: [
      {
        type: "ul",
        items: [
          "Provide accurate details when you sign up and when you book, and keep them up to date.",
          "Verify your email address before booking.",
          "Keep your password private. You are responsible for activity on your account, so tell us straight away if you think someone else has used it.",
          "We may sign you out automatically after a period of inactivity to protect your information.",
        ],
      },
    ],
  },
  {
    id: "booking",
    title: "6. Booking and scheduling",
    blocks: [
      {
        type: "ul",
        items: [
          "After you pay, our team assigns you a doctor and a time and tells you by email, and may also contact you by phone or WhatsApp.",
          "Keep your phone reachable and join or arrive on time. If you miss your appointment without letting us know, the hospital may treat the consultation as completed.",
          "You can ask to reschedule from your dashboard or by calling the hospital. Rescheduling depends on availability.",
          "For online consultations, you are responsible for a working internet connection, a device with a camera and microphone, and a private place to talk.",
        ],
      },
    ],
  },
  {
    id: "fees",
    title: "7. Fees and payment",
    blocks: [
      {
        type: "ul",
        items: [
          "The fee is shown before you pay. It depends on the consultation type and may be higher if you choose a specialist.",
          "You pay by mobile money through Paystack. We do not see or store your mobile money PIN.",
          "The amount charged is decided by our system, not by your browser, and your booking is only created once the payment is confirmed.",
          "If a payment fails, your booking is not created and you can try again. If money leaves your account but your booking does not appear, contact the hospital with your payment details and we will investigate.",
        ],
      },
    ],
  },
  {
    id: "refunds",
    title: "8. Cancellations and refunds",
    blocks: [
      {
        type: "ul",
        items: [
          "If the hospital cannot provide your consultation, for example because no doctor is available, you can reschedule or ask for a refund of the amount you paid.",
          "If you cancel or do not attend, the hospital decides whether a refund or a new appointment is possible, taking into account how much notice you gave.",
          "Approved refunds are returned to the mobile money account used for payment.",
        ],
      },
    ],
  },
  {
    id: "conduct",
    title: "9. How you may use the platform",
    blocks: [
      {
        type: "p",
        text: "You agree not to:",
      },
      {
        type: "ul",
        items: [
          "Give false information or pretend to be someone else.",
          "Book or pay using an account, phone number or mobile money account that is not yours or that you are not allowed to use.",
          "Be abusive, threatening or disrespectful to doctors or staff.",
          "Record, share or publish a consultation without the permission of everyone in it.",
          "Try to break, overload or gain unauthorised access to the platform or to other people's information.",
        ],
      },
    ],
  },
  {
    id: "privacy",
    title: "10. Your information and recordings",
    blocks: [{ type: "privacy" }],
  },
  {
    id: "availability",
    title: "11. Availability",
    blocks: [
      {
        type: "p",
        text: "We work to keep the platform running, but it may sometimes be unavailable because of maintenance, faults, or problems with the internet or mobile networks that we do not control. If a technical problem stops your consultation from going ahead, we will help you reschedule.",
      },
    ],
  },
  {
    id: "liability",
    title: "12. Our responsibility",
    blocks: [
      {
        type: "p",
        text: "We take reasonable care in providing the service. Nothing in these terms limits any right you have under Ghanaian law that cannot be limited, including our responsibility for the quality of medical care. Apart from that, the hospital is not responsible for losses caused by things outside our reasonable control, such as network or power failures, or by information you gave us that was wrong or incomplete.",
      },
    ],
  },
  {
    id: "suspension",
    title: "13. Suspending accounts",
    blocks: [
      {
        type: "p",
        text: "We may suspend or close an account if these terms are broken, if we suspect fraud or misuse, or to protect patients and staff. You can also ask us to close your account at any time.",
      },
    ],
  },
  {
    id: "changes",
    title: "14. Changes to these terms",
    blocks: [
      {
        type: "p",
        text: "We may update these terms from time to time. We will change the date at the top of this page, and tell you before a significant change takes effect. If you keep using the platform after that, you accept the updated terms.",
      },
    ],
  },
  {
    id: "law",
    title: "15. Governing law",
    blocks: [
      {
        type: "p",
        text: "These terms are governed by the laws of Ghana. If we cannot resolve a disagreement together, it can be taken to the courts of Ghana.",
      },
    ],
  },
];

function Block({ block }) {
  if (block.type === "ul") {
    return (
      <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-black/80 marker:text-[#F88535]">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  if (block.type === "privacy") {
    return (
      <p className="mt-3 text-[15px] leading-relaxed text-black/80">
        How we collect, use, store and delete your information is explained in
        our{" "}
        <Link
          to="/privacy"
          className="text-[#0095D9] underline hover:text-[#0077ad]"
        >
          privacy policy
        </Link>
        . That includes the audio record we keep of consultations for legal
        purposes. By booking, you agree to the way we handle your information as
        described there.
      </p>
    );
  }
  return (
    <p className="mt-3 text-[15px] leading-relaxed text-black/80">
      {block.text}
    </p>
  );
}

export default function Terms() {
  const { initializing } = useAuth();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <HealthcarePreloader label="Loading..." size={48} />
      </div>
    );
  }

  return (
    <div className="font-body text-black bg-white min-h-screen overflow-x-hidden flex flex-col">
      <Header variant="minimal" cancelHref="/" cancelLabel="Back to home" />

      <div
        className="text-white"
        style={{
          background: "linear-gradient(100deg, #F88535 0%, #0095D9 100%)",
        }}
      >
        <div className="mx-auto max-w-3xl px-5 sm:px-8 py-8 sm:py-10">
          <p className="text-[12.5px] font-medium uppercase tracking-wide text-white/70">
            Holy Family Catholic Hospital
          </p>
          <h1 className="mt-1 font-display text-[28px] sm:text-[34px] font-medium">
            Terms of service
          </h1>
          <p className="mt-2 text-[14px] text-white/80">
            Last updated {LAST_UPDATED}
          </p>
        </div>
      </div>

      <main className="flex-1 mx-auto w-full max-w-3xl px-5 sm:px-8 py-8 sm:py-12">
        <p className="text-[16px] leading-relaxed text-black/80">
          These terms explain the rules for using the hospital's telemedicine
          platform to book and attend consultations. Please read them before you
          book.
        </p>

        <nav
          aria-label="On this page"
          className="mt-8 rounded-2xl border border-black/10 p-5"
        >
          <p className="text-[13px] font-medium uppercase tracking-wide text-black/60">
            On this page
          </p>
          <ol className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="text-[14.5px] text-[#0095D9] hover:underline"
                >
                  {section.title}
                </a>
              </li>
            ))}
            <li>
              <a
                href="#contact"
                className="text-[14.5px] text-[#0095D9] hover:underline"
              >
                16. Contact us
              </a>
            </li>
          </ol>
        </nav>

        <div className="mt-10 space-y-10">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-24">
              <h2 className="font-display text-[22px] font-medium">
                {section.title}
              </h2>
              {section.blocks.map((block, i) => (
                <Block key={i} block={block} />
              ))}
            </section>
          ))}

          <section id="contact" className="scroll-mt-24">
            <h2 className="font-display text-[22px] font-medium">
              16. Contact us
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-black/80">
              For questions about these terms, email{" "}
              <a
                href={`mailto:${TERMS_EMAIL}`}
                className="text-[#0095D9] underline hover:text-[#0077ad]"
              >
                {TERMS_EMAIL}
              </a>{" "}
              or{" "}
              <a
                href={HOSPITAL_PHONE_TEL}
                className="text-[#0095D9] underline hover:text-[#0077ad]"
              >
                call the hospital
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-12">
          <Link
            to="/"
            className="inline-flex rounded-full border border-black/20 px-6 py-3 text-[15px] font-medium transition hover:border-black/40"
          >
            Back to home
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}
