// MiniCharts.jsx — small SVG charts with no charting library dependency.

export function BarChart({
  data = [],
  seriesA,
  seriesB,
  colorA = "var(--color-primary)",
  colorB = "var(--color-secondary)",
  height = 180,
}) {
  const barW = 22;
  const gap = 26;

  if (data.length === 0) {
    return (
      <div className="mini-chart-empty" style={{ height: height + 26 }}>
        No data yet
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d[seriesA] + d[seriesB])) || 1;
  const width = data.length * (barW + gap);

  return (
    <svg
      viewBox={`0 0 ${width} ${height + 26}`}
      width="100%"
      height={height + 26}
      role="img"
      aria-label="Consultations by day"
    >
      {data.map((d, i) => {
        const x = i * (barW + gap) + gap / 2;
        const hA = (d[seriesA] / max) * height;
        const hB = (d[seriesB] / max) * height;
        return (
          <g key={d.day}>
            <rect
              x={x}
              y={height - hA}
              width={barW}
              height={hA}
              rx="4"
              fill={colorA}
            />
            <rect
              x={x}
              y={height - hA - hB}
              width={barW}
              height={hB}
              rx="4"
              fill={colorB}
            />
            <text
              x={x + barW / 2}
              y={height + 18}
              textAnchor="middle"
              fontSize="10.5"
              fill="var(--color-ink-faint)"
            >
              {d.day}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Donut({ data = [], size = 140, thickness = 18 }) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;

  if (data.length === 0) {
    return (
      <div className="mini-chart-empty" style={{ width: size, height: size }}>
        No data yet
      </div>
    );
  }

  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  let offset = 0;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Consultation outcomes"
    >
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-surface)"
          strokeWidth={thickness}
        />
        {data.map((d) => {
          const frac = d.value / total;
          const dash = frac * c;
          const el = (
            <circle
              key={d.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={d.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += dash;
          return el;
        })}
      </g>
      <text
        x="50%"
        y="47%"
        textAnchor="middle"
        fontSize="20"
        fontWeight="800"
        fill="var(--color-ink)"
      >
        {total}
      </text>
      <text
        x="50%"
        y="61%"
        textAnchor="middle"
        fontSize="10.5"
        fill="var(--color-ink-soft)"
      >
        sessions
      </text>
    </svg>
  );
}
