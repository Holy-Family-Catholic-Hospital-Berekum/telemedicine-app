import { Link } from "react-router-dom";
import logo from "../../src/assets/logo.png";

/**
 * Footer.jsx
 * Modern healthcare footer for Holy Family Catholic Hospital.
 *
 * Brand palette:
 *   Orange: #F88535
 *   Blue:   #0095D9
 *   White:  #FFFFFF
 */

// lucide-react dropped brand/social icons a while back (licensing), so
// these three are small local SVGs instead of a lucide import — same
// 1.75-ish stroke weight as the rest of the app's icons, sized via the
// `size` prop like a lucide icon would be.
function FacebookIcon({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M15 8.5h2V5.2c-.35-.05-1.54-.15-2.94-.15-2.9 0-4.89 1.77-4.89 5.02V13H6.5v3.5h3.17V23h3.62v-6.5h3.04l.48-3.5h-3.52v-2.6c0-1 .28-1.9 1.71-1.9Z"
        fill="currentColor"
      />
    </svg>
  );
}
function InstagramIcon({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="4.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="17.15" cy="6.85" r="1.1" fill="currentColor" />
    </svg>
  );
}
function YoutubeIcon({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2.5"
        y="5.5"
        width="19"
        height="13"
        rx="3.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path d="M10.5 9.5v5l4.3-2.5-4.3-2.5Z" fill="currentColor" />
    </svg>
  );
}

const SOCIAL_LINKS = [
  {
    label: "Facebook",
    href: "https://www.facebook.com/hfhberekum/",
    Icon: FacebookIcon,
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/hfhberekum_gh/",
    Icon: InstagramIcon,
  },
  {
    label: "YouTube",
    href: "https://www.youtube.com/@HFCHBerekum",
    Icon: YoutubeIcon,
  },
];

export default function Footer() {
  return (
    <footer
      id="contact"
      className="relative overflow-hidden bg-[#0095D9] text-white"
    >
      {/* Subtle decorative shapes */}
      <div
        aria-hidden="true"
        className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/[0.06]"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-[#F88535]/[0.12]"
      />

      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        {/* Main footer */}
        <div className="grid gap-10 py-12 sm:py-16 md:grid-cols-[1.4fr_1fr_1fr] md:gap-12">
          {/* Hospital identity */}
          <div>
            <Link
              to="/"
              className="group inline-flex items-center gap-3"
              aria-label="Holy Family Catholic Hospital home"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-lg shadow-black/10">
                <img
                  src={logo}
                  alt="Holy Family Catholic Hospital"
                  className="h-9 w-9 rounded-full object-contain"
                />
              </div>

              <div>
                <p className="font-display text-[17px] font-semibold leading-tight">
                  Holy Family Catholic Hospital
                </p>
                <p className="mt-0.5 text-[13px] text-white/75">
                  Berekum, Ghana
                </p>
              </div>
            </Link>

            <p className="mt-6 max-w-sm text-[14px] leading-6 text-white/80">
              Quality healthcare, made simpler. Connect with our healthcare
              services and manage your consultations with ease.
            </p>

            {/* Social links */}
            <div className="mt-6 flex items-center gap-3">
              {SOCIAL_LINKS.map(({ label, href, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/25 text-white/85
                             transition-colors hover:border-white/50 hover:bg-white/10 hover:text-white"
                >
                  <Icon size={16} />
                </a>
              ))}
            </div>

            {/* Brand accent */}
            <div className="mt-6 flex items-center gap-2">
              <span className="h-1.5 w-10 rounded-full bg-[#F88535]" />
              <span className="h-1.5 w-2 rounded-full bg-white/60" />
              <span className="h-1.5 w-2 rounded-full bg-white/40" />
            </div>
          </div>

          {/* Quick links */}
          <div>
            <h3 className="text-[13px] font-bold uppercase tracking-[0.16em] text-white/70">
              Quick Links
            </h3>

            <nav className="mt-5 flex flex-col items-start gap-3.5 text-[14px]">
              <Link
                to="/"
                className="text-white/85 transition-colors hover:text-white"
              >
                Home
              </Link>

              <Link
                to="/book"
                className="text-white/85 transition-colors hover:text-white"
              >
                Book a consultation
              </Link>

              <Link
                to="/dashboard"
                className="text-white/85 transition-colors hover:text-white"
              >
                Dashboard
              </Link>
            </nav>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-[13px] font-bold uppercase tracking-[0.16em] text-white/70">
              Contact
            </h3>

            <div className="mt-5 space-y-4 text-[14px]">
              <div>
                <p className="text-[12px] font-medium uppercase tracking-wide text-white/55">
                  Address
                </p>
                <p className="mt-1 text-white/90 leading-6">
                  Holy Family Hospital
                  <br />
                  P.O. Box 21, Berekum
                  <br />
                  Brong Ahafo, Ghana – West Africa
                </p>
              </div>

              <div>
                <p className="text-[12px] font-medium uppercase tracking-wide text-white/55">
                  Phone
                </p>
                <p className="mt-1 text-white/90 leading-6">
                  <a
                    href="tel:+233352222034"
                    className="hover:text-white transition-colors"
                  >
                    035 222 2034
                  </a>
                  {" | "}
                  <a
                    href="tel:+233352022433"
                    className="hover:text-white transition-colors"
                  >
                    035-20-22433
                  </a>
                  {" | "}
                  <a
                    href="tel:+233501156668"
                    className="hover:text-white transition-colors"
                  >
                    +233 50 115 6668
                  </a>
                </p>
              </div>

              <div>
                <p className="text-[12px] font-medium uppercase tracking-wide text-white/55">
                  Email
                </p>
                <p className="mt-1 text-white/90 leading-6">
                  <a
                    href="mailto:info@hfhberekum.org"
                    className="hover:text-white transition-colors"
                  >
                    info@hfhberekum.org
                  </a>
                  <br />
                  <a
                    href="mailto:hfhberekum@yahoo.co.uk"
                    className="hover:text-white transition-colors"
                  >
                    hfhberekum@yahoo.co.uk
                  </a>
                </p>
              </div>

              <div>
                <p className="text-[12px] font-medium uppercase tracking-wide text-white/55">
                  GPS
                </p>
                <p className="mt-1 text-white/90">BB-0020-8042</p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/15 py-5">
          <div className="flex flex-col gap-4 text-[12px] text-white/65 sm:flex-row sm:items-center sm:justify-between">
            <p>
              © {new Date().getFullYear()} Holy Family Catholic Hospital. All
              rights reserved.
            </p>

            <nav
              aria-label="Legal"
              className="flex items-center gap-x-5 gap-y-2 flex-wrap"
            >
              <Link
                to="/privacy"
                className="transition-colors hover:text-white"
              >
                Privacy policy
              </Link>
              <Link to="/terms" className="transition-colors hover:text-white">
                Terms of service
              </Link>
            </nav>
          </div>
        </div>
      </div>
    </footer>
  );
}
