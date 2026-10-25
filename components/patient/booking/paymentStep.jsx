import { BackButton, DoctorAvatar, ErrorMessage, Spinner } from "./bookingUi";

// Step 1: pay online via Paystack.
export default function PaymentStep({
  paying,
  paymentState,
  onBack,
  type,
  mode,
  selectedDoctor,
  booking,
  fee,
  currency: CURRENCY,
  error,
  errorRef,
  handleCheckPaymentStatus,
  handlePay,
  payButtonLabel,
}) {
  return (
    <section>
      {!paying && paymentState !== "pending" && (
        <BackButton onClick={onBack}>
          Back to consultation details
        </BackButton>
      )}

      <h2 className="font-display text-[22px] sm:text-[24px] font-medium">
        Pay for your consultation
      </h2>
      <p className="mt-2 text-[16px] text-black/80">
        You pay with mobile money. A message will pop up on your
        phone: enter your MoMo PIN there to approve the payment.
      </p>

      <div className="mt-7 rounded-2xl border border-black/10 p-6 sm:p-7 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[16px] text-black/80">
            Consultation
          </span>
          <span className="text-right text-[16px] font-medium">
            {type === "OPD" ? "General OPD" : "Surgical"}
            <span className="block text-[16px] font-normal text-black/75">
              {mode === "online" ? "Video call" : "At the hospital"}
            </span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-black/10 pt-5">
          <span className="text-[16px] text-black/80">Doctor</span>
          {selectedDoctor ? (
            <span className="flex items-center gap-2.5 text-right">
              <DoctorAvatar doctor={selectedDoctor} size={32} />
              <span className="text-[16px] font-medium">
                {selectedDoctor.name}
              </span>
            </span>
          ) : (
            <span className="text-[16px] text-black/75">
              To be assigned
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-black/10 pt-5">
          <span className="text-[16px] text-black/80">
            Amount due
          </span>
          <span className="font-display text-[20px] font-medium">
            {booking?.currency ?? CURRENCY} {fee}
          </span>
        </div>
      </div>

      <p className="mt-5 text-[16px] bg-[#0095D9] px-4 py-2.5 rounded text-white leading-relaxed">
        Please keep this page open until the payment is done.
      </p>

      {/* Awaiting-network state: payment left the phone but the
          server hasn't confirmed it yet. No booking yet. */}
      {paymentState === "pending" && (
        <div
          role="status"
          className="mt-6 rounded-2xl border border-[#0095D9]/40 bg-[#0095D9]/5 px-5 py-4 text-[16px] text-black/80"
        >
          <span className="font-medium text-black">
            We are waiting for your payment to go through.
          </span>{" "}
          This can take a few minutes. Please keep this page open.
        </div>
      )}

      <div className="mt-8">
        <ErrorMessage error={error} innerRef={errorRef} />

        <div className="flex flex-wrap items-center gap-3">
          {paymentState === "pending" ? (
            <button
              type="button"
              onClick={handleCheckPaymentStatus}
              disabled={paying}
              className="inline-flex items-center gap-2 rounded-full bg-[#F88535] text-white text-[16px] font-medium px-7 py-3.5
                         hover:brightness-95 active:brightness-90 transition disabled:opacity-60"
            >
              {paying && <Spinner />}
              {paying
                ? "Checking payment…"
                : "Check my payment"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePay}
              disabled={paying}
              className="inline-flex items-center gap-2 rounded-full bg-[#F88535] text-white text-[16px] font-medium px-7 py-3.5
                         hover:brightness-95 active:brightness-90 transition disabled:opacity-60"
            >
              {paying && <Spinner />}
              {payButtonLabel}
            </button>
          )}

          {paymentState === "checkout" && (
            <span className="text-[16px] text-black/75">
              Check your phone and enter your MoMo PIN to approve.
            </span>
          )}
        </div>

        <p className="mt-4 text-[15px] text-black/75">
          Payments are processed by Paystack. We never see or store
          your mobile money PIN.
        </p>
        <p className="mt-2 text-[15px] text-[#8A2626]">
          Only pay here, on this website. We will never call,
          text or WhatsApp you to ask you to send money.
        </p>
      </div>
    </section>
  );
}
