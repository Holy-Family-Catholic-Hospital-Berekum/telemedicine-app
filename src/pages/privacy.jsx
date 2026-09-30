import { useEffect } from "react";
import { Link } from "react-router-dom";
import Header from "../../components/shared/header";
import Footer from "../../components/shared/footer";
import { HOSPITAL_PHONE_TEL } from "../../components/shared/contact";
import { useAuth } from "../context/authContext.jsx";
import HealthcarePreloader from "../components/common/healthcarePreloader.jsx";

/**
 * privacy.jsx
 * Public privacy policy, lives at "/privacy". The booking page links here
 * from its consent checkbox (opens in a new tab), so the wording below
 * mirrors what that checkbox promises.
 *
 * BEFORE LAUNCH, confirm these with the hospital (they are the parts of
 * this policy the code cannot tell us):
 *   - PRIVACY_EMAIL: a real, monitored address for privacy requests.
 *   - How long consultation audio recordings are kept (section 6).
 *   - Whether payment and accounting records are kept after a consultation
 *     is deleted (section 6).
 *   - Whether the hospital is registered with Ghana's Data Protection
 *     Commission and has a named data protection supervisor.
 *   - Which video provider is actually used in production (section 4).
 * Have the hospital's legal or compliance lead review the final text.
 */

const LAST_UPDATED = "30 September 2026";
const PRIVACY_EMAIL = "info@hfhberekum.org";

const sections = [
  {
    id: "who-we-are",
    title: "1. Who we are",
    blocks: [
      {
        type: "p",
        text: 'This platform is run by Holy Family Catholic Hospital, Berekum, Ghana ("the hospital", "we", "us"). It lets you book and attend General OPD and surgical consultations online or in person. The hospital is the controller of the personal information described in this policy.',
      },
    ],
  },
  {
    id: "what-we-collect",
    title: "2. What we collect",
    blocks: [
      {
        type: "p",
        text: "We only collect what we need to run your consultation.",
      },
      {
        type: "ul",
        items: [
          "Account details: your name, phone number and email address, and a password that is handled by our sign-in provider (we never see or store it in readable form).",
          "Booking details: consultation type, online or in-person mode, your date of birth, sex, town or city, area or nearest landmark, phone number, and the doctor you choose, if any.",
          "Payment details: the amount, the payment reference and whether the payment succeeded. Payment is made by mobile money through Paystack. We never see or store your mobile money PIN.",
          "Consultation information: what you share with your doctor during the consultation, and an audio record of the consultation (see section 5).",
          "Basic technical data needed to keep the service working and secure, such as sign-in activity.",
        ],
      },
    ],
  },
  {
    id: "why-we-use-it",
    title: "3. Why we use it",
    blocks: [
      {
        type: "ul",
        items: [
          "To set up your consultation, assign a doctor and schedule a time.",
          "To contact you about your appointment by phone, WhatsApp or email.",
          "To confirm your payment.",
          "To keep the platform secure and to keep a record of important actions, such as payment confirmations and schedule changes.",
          "To produce anonymous statistics that help us improve the service.",
        ],
      },
    ],
  },
  {
    id: "who-sees-it",
    title: "4. Who can see your information",
    blocks: [
      {
        type: "p",
        text: "Clinical details you share are visible only to the doctor handling your consultation. Hospital staff who schedule and administer consultations can see your booking details, but only what their role needs.",
      },
      {
        type: "p",
        text: "We use a small number of service providers to run the platform. They process information on our behalf and only for that purpose:",
      },
      {
        type: "ul",
        items: [
          "Google Firebase, for sign-in, database and file storage.",
          "Paystack, for mobile money payments.",
          "A video conferencing service, for online consultations.",
        ],
      },
      {
        type: "p",
        text: "We do not sell your information and we do not use it for advertising.",
      },
    ],
  },
  {
    id: "recording",
    title: "5. Consultation recording",
    blocks: [
      {
        type: "p",
        text: "We keep an audio record of consultations for legal and security purposes. Access to recordings is restricted, and they are not used for marketing or for any purpose unrelated to the consultation.",
      },
    ],
  },
  {
    id: "retention",
    title: "6. How long we keep it",
    blocks: [
      {
        type: "ul",
        items: [
          "Booking and consultation details you provided are deleted once your consultation is marked complete.",
          "Only anonymised, non-identifying statistics are kept afterward.",
          "Consultation audio recordings are kept only as long as needed for the legal purposes above, then deleted.",
          "Your account details are kept while your account is active. You can ask us to delete your account at any time (see section 8).",
        ],
      },
    ],
  },
  {
    id: "security",
    title: "7. How we protect it",
    blocks: [
      {
        type: "ul",
        items: [
          "Role-based access, so patients, doctors and administrators only see what they are allowed to.",
          "Email verification before you can book.",
          "Automatic sign-out after a period of inactivity, shorter for hospital staff than for patients.",
          "Payments handled entirely by Paystack, not on our servers.",
        ],
      },
      {
        type: "p",
        text: "No online service can promise perfect security, but we work to keep your information protected and limit who can see it.",
      },
    ],
  },
  {
    id: "your-rights",
    title: "8. Your rights",
    blocks: [
      {
        type: "p",
        text: "Under Ghana's Data Protection Act, 2012 (Act 843), you can ask us to:",
      },
      {
        type: "ul",
        items: [
          "Tell you what personal information we hold about you and give you a copy.",
          "Correct information that is wrong or out of date.",
          "Delete your information, where we no longer need it.",
          "Stop using your information in a particular way.",
        ],
      },
      {
        type: "p",
        text: "If you are not happy with how we handle your information, you can complain to Ghana's Data Protection Commission.",
      },
    ],
  },
  {
    id: "changes",
    title: "9. Changes to this policy",
    blocks: [
      {
        type: "p",
        text: "If we change how we handle your information, we will update this page and the date at the top. If a change is significant, we will tell you before it takes effect.",
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
  return (
    <p className="mt-3 text-[15px] leading-relaxed text-black/80">
      {block.text}
    </p>
  );
}

export default function Privacy() {
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
            Privacy policy
          </h1>
          <p className="mt-2 text-[14px] text-white/80">
            Last updated {LAST_UPDATED}
          </p>
        </div>
      </div>

      <main className="flex-1 mx-auto w-full max-w-3xl px-5 sm:px-8 py-8 sm:py-12">
        <p className="text-[16px] leading-relaxed text-black/80">
          This policy explains what personal information the hospital's
          telemedicine platform collects, why, who sees it, and how long we keep
          it. We have tried to keep it short and plain.
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
                10. Contact us
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
              10. Contact us
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-black/80">
              To use any of your rights, or to ask a question about this policy,
              email{" "}
              <a
                href={`mailto:${PRIVACY_EMAIL}`}
                className="text-[#0095D9] underline hover:text-[#0077ad]"
              >
                {PRIVACY_EMAIL}
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
