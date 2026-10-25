export default function StepIndicator({ stepLabels, step }) {
  return (
    <>
      {/* ---------- Step indicator ---------- */}
      <ol className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-12">
        {stepLabels.map((label, i) => (
          <li
            key={label}
            className="flex items-center flex-1 last:flex-none"
          >
            <div className="flex items-center gap-2 sm:gap-2.5">
              <span
                className={
                  "flex items-center justify-center h-7 w-7 sm:h-8 sm:w-8 rounded-full text-[16px] font-medium shrink-0 " +
                  (i < step
                    ? "bg-[#0095D9] text-white"
                    : i === step
                      ? "bg-[#F88535] text-white"
                      : "bg-black/10 text-black/75")
                }
              >
                {i < step ? (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 20 20"
                    fill="none"
                  >
                    <path
                      d="M4 10l4 4l8-8"
                      stroke="white"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={
                  "hidden sm:inline text-[16px] " +
                  (i === step
                    ? "text-black font-medium"
                    : "text-black/75")
                }
              >
                {label}
              </span>
            </div>
            {i < stepLabels.length - 1 && (
              <span className="flex-1 h-px bg-black/10 mx-2 sm:mx-3" />
            )}
          </li>
        ))}
      </ol>
      {/* Mobile equivalent of the desktop step labels. */}
      <p className="sm:hidden mb-9 text-[16px] text-black/75">
        Step {step + 1} of {stepLabels.length} — {stepLabels[step]}
      </p>
    </>
  );
}
