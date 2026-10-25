import { Link } from "react-router-dom";
import { DoctorAvatar } from "./bookingUi";

// Step 2: booked (paid, or a hospital visit to pay for there).
export default function BookingDone({ booking, selectedDoctor }) {
  return (
    <section className="text-center sm:text-left">
      <div className="mx-auto sm:mx-0 h-14 w-14 rounded-full bg-[#0095D9]/10 flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 13l4 4l10-10"
            stroke="#0095D9"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="mt-5 font-display text-[22px] sm:text-[24px] font-medium">
        {booking.payAtHospital
          ? "Your visit is booked"
          : "Payment received. Your booking is done"}
      </h2>
      <p className="mt-2 text-[16px] text-black/80 max-w-md mx-auto sm:mx-0">
        {booking.payAtHospital
          ? `You pay ${booking.currency} ${booking.amount} at the hospital when you come. `
          : `We've received ${booking.currency} ${booking.amount}. `}
        You will receive an email with your appointment time
        {selectedDoctor ? "" : " and doctor"} as soon as it is set.
      </p>

      <div className="mt-7 rounded-2xl border border-black/10 px-5 py-4 max-w-md mx-auto sm:mx-0 text-left space-y-3">
        <div>
          <span className="block text-[16px] text-black/75">
            {booking.payAtHospital ? "To pay at the hospital" : "Paid"}
          </span>
          <span className="mt-0.5 block font-display text-[19px] font-medium">
            {booking.currency} {booking.amount}
            {booking.payAtHospital ? "" : " by mobile money"}
          </span>
        </div>
        {selectedDoctor && (
          <div className="border-t border-black/10 pt-3 flex items-center gap-3">
            <DoctorAvatar doctor={selectedDoctor} />
            <div>
              <span className="block text-[16px] font-medium">
                {selectedDoctor.name}
              </span>
              <span className="block text-[15px] text-black/75">
                {selectedDoctor.role}
              </span>
            </div>
          </div>
        )}
      </div>

      <p className="mt-6 text-[16px] text-black/75 max-w-md mx-auto sm:mx-0">
        We'll email you your appointment time
        once{" "}
        {selectedDoctor ? "a time is" : "a doctor and time are"}{" "}
        assigned. You can see this booking any time from your
        Dashboard.
      </p>

      <div className="mt-8 flex flex-wrap justify-center sm:justify-start gap-3">
        <Link
          to="/"
          className="rounded-full border border-black/20 text-[16px] font-medium px-6 py-3
                     hover:border-black/40 transition"
        >
          Back to home
        </Link>
        <Link
          to={"/dashboard"}
          className="rounded-full bg-[#F88535] text-white text-[16px] font-medium px-6 py-3
                     hover:brightness-95 active:brightness-90 transition"
        >
          Go to my appointments
        </Link>
      </div>
    </section>
  );
}
