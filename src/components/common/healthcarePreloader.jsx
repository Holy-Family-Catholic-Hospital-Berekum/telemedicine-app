// HealthcarePreloader.jsx
//
// Small, dependency-free loading indicator: a spinning ring in the
// brand gradient with an animated ECG line drawing itself inside it.
// Used for initial auth-state resolution and in-flight form submits.
// Respects prefers-reduced-motion (see auth.css).

import "../../styles/auth.css";

export default function HealthcarePreloader({
  label = "Loading…",
  fullscreen = false,
  size = 88,
}) {
  const content = (
    <div className="hp-wrap" role="status" aria-live="polite">
      <svg
        className="hp-ring"
        width={size}
        height={size}
        viewBox="0 0 88 88"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="hpGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#EA7321" />
            <stop offset="100%" stopColor="#0095D9" />
          </linearGradient>
        </defs>
        <circle className="hp-track" cx="44" cy="44" r="37" />
        <circle
          className="hp-arc"
          cx="44"
          cy="44"
          r="37"
          stroke="url(#hpGrad)"
        />
        <path className="hp-pulse" d="M9 44h13l5-15 8 28 6-20 4 7h34" />
      </svg>
      {label && <p className="hp-label">{label}</p>}
    </div>
  );

  if (!fullscreen) return content;
  return <div className="hp-fullscreen">{content}</div>;
}
