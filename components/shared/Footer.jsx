import { Link } from "react-router-dom";
import logo from "../../src/assets/logo.png";

/**
 * Footer.jsx (components/shared)
 * Reusable site footer: hospital identity, contact placeholders, and an
 * intentionally unobtrusive "Staff login" link to /admin (not part of the
 * main nav, so the admin area stays effectively unlisted to the public).
 *
 * Relies on the CSS custom properties defined in Header.jsx's <style> block
 * (--ink, etc). Make sure Header is rendered somewhere on the same page.
 *
 * Update the placeholder phone/email before shipping.
 */

export default function Footer() {
  return (
    <footer id="contact" className="border-t border-[#14213814] py-10 sm:py-14">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 flex flex-col md:flex-row md:items-start justify-between gap-8 sm:gap-10">
        <div className="flex items-center gap-3">
          <img src={logo} alt="" className="h-10 w-10 rounded-full" />
          <div>
            <p className="font-display text-[15px] font-medium">
              Holy Family Catholic Hospital
            </p>
            <p className="text-[13px] text-[#14213899]">Berekum, Ghana</p>
          </div>
        </div>

        <div className="text-[14px] text-[#142138cc] space-y-1">
          <p>Reach us for anything not covered by the app:</p>
          <p className="font-medium text-[var(--ink)]">
            Phone: [hospital line] &nbsp;·&nbsp; Email: [hospital email]
          </p>
        </div>

        <div className="text-[13px] text-[#14213899] space-y-3">
          <p>&copy; {new Date().getFullYear()} Holy Family Catholic Hospital</p>
          <Link to="/admin" className="underline hover:text-[var(--ink)]">
            Staff login
          </Link>
        </div>
      </div>
    </footer>
  );
}
