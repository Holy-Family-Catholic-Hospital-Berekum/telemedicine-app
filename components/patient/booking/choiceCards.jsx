/**
 * A choice of two big cards (consultation type, or how to see the doctor).
 * `locked`: a claimed slot fixed the choice, so the other card is disabled.
 * `children` sit between the legend and the cards.
 */
export default function ChoiceCards({ legend, options, value, onChange, locked, children }) {
  return (
    <fieldset className="mt-8">
      <legend className="text-[16px] font-medium mb-3">
        {legend}
      </legend>
      {children}
      <div className="grid sm:grid-cols-2 gap-3">
        {options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            disabled={locked && value !== opt.key}
            aria-pressed={value === opt.key}
            className={
              "text-left rounded-2xl p-5 border-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed " +
              (value === opt.key
                ? "border-[#F88535] bg-[#F88535]/10"
                : "border-black/10 hover:border-black/30")
            }
          >
            <span className="block font-medium text-[16px]">
              {opt.title}
            </span>
            <span className="block mt-1 text-[16px] text-black/80">
              {opt.desc}
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
