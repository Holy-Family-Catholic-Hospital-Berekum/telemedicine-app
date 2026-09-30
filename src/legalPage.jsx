import { useEffect } from "react";
import { Link } from "react-router-dom";
import Header from "../components/shared/header.jsx";
import Footer from "../components/shared/footer";
import { HOSPITAL_PHONE_TEL } from "../components/shared/contact";
import { useAuth } from "./context/authContext.jsx";
import HealthcarePreloader from "./components/common/healthcarePreloader.jsx";
import { useLegalDoc, parseBody } from "./legalDocs";

const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const LINK_CLASS = "text-[#0095D9] underline hover:text-[#0077ad]";

// Only a short list of link targets is honoured, so admin-entered text can
// never produce a javascript: or other unexpected link.
function SafeLink({ href, children }) {
  if (href.startsWith("/") && !href.startsWith("//")) {
    return (
      <Link to={href} className={LINK_CLASS}>
        {children}
      </Link>
    );
  }
  if (/^(mailto:|tel:)/i.test(href)) {
    return (
      <a href={href} className={LINK_CLASS}>
        {children}
      </a>
    );
  }
  if (/^https:\/\//i.test(href)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={LINK_CLASS}
      >
        {children}
      </a>
    );
  }
  return <>{children}</>;
}

function Inline({ text }) {
  const out = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(LINK_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <SafeLink key={key++} href={m[2]}>
        {m[1]}
      </SafeLink>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function Block({ block }) {
  if (block.type === "ul") {
    return (
      <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-black/80 marker:text-[#F88535]">
        {block.items.map((item, i) => (
          <li key={i}>
            <Inline text={item} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p className="mt-3 text-[15px] leading-relaxed text-black/80">
      <Inline text={block.text} />
    </p>
  );
}

/**
 * docId: "terms" | "privacy"
 * heading: page title, e.g. "Privacy policy"
 * contactLead: sentence that leads into the email link
 */
export default function LegalPage({ docId, heading, contactLead }) {
  const { initializing } = useAuth();
  const { loading, content } = useLegalDoc(docId);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  if (initializing || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <HealthcarePreloader label="Loading..." size={48} />
      </div>
    );
  }

  const { sections, intro, contactEmail, lastUpdated } = content;
  const numbered = sections.map((s, i) => ({
    ...s,
    heading: `${i + 1}. ${s.title}`,
  }));
  const contactHeading = `${sections.length + 1}. Contact us`;

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
            {heading}
          </h1>
          <p className="mt-2 text-[14px] text-white/80">
            Last updated {lastUpdated}
          </p>
        </div>
      </div>

      <main className="flex-1 mx-auto w-full max-w-3xl px-5 sm:px-8 py-8 sm:py-12">
        <p className="text-[16px] leading-relaxed text-black/80">
          <Inline text={intro} />
        </p>

        <nav
          aria-label="On this page"
          className="mt-8 rounded-2xl border border-black/10 p-5"
        >
          <p className="text-[13px] font-medium uppercase tracking-wide text-black/60">
            On this page
          </p>
          <ol className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {numbered.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="text-[14.5px] text-[#0095D9] hover:underline"
                >
                  {s.heading}
                </a>
              </li>
            ))}
            <li>
              <a
                href="#contact"
                className="text-[14.5px] text-[#0095D9] hover:underline"
              >
                {contactHeading}
              </a>
            </li>
          </ol>
        </nav>

        <div className="mt-10 space-y-10">
          {numbered.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <h2 className="font-display text-[22px] font-medium">
                {s.heading}
              </h2>
              {parseBody(s.body).map((block, i) => (
                <Block key={i} block={block} />
              ))}
            </section>
          ))}

          <section id="contact" className="scroll-mt-24">
            <h2 className="font-display text-[22px] font-medium">
              {contactHeading}
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-black/80">
              {contactLead}{" "}
              <a href={`mailto:${contactEmail}`} className={LINK_CLASS}>
                {contactEmail}
              </a>{" "}
              or{" "}
              <a href={HOSPITAL_PHONE_TEL} className={LINK_CLASS}>
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
