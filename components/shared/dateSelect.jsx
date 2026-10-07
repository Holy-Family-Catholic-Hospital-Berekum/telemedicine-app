import { useState } from "react";

// Day / Month / Year as three dropdowns, in that order on every device
// (hospital decision: the browser's own date picker shows month/day/year
// on many phones). Value in and out is "YYYY-MM-DD", or "" until all three
// are chosen. `id` goes on the Day box so a <label htmlFor={id}> works.
//
//   <DateSelect id="dob" value={dob} onChange={setDob} fromYear={1900} toYear={2026} newestFirst />

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n) => String(n).padStart(2, "0");
const daysIn = (year, month) => new Date(Date.UTC(year || 2000, month, 0)).getUTCDate();

function split(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  return m ? { y: m[1], m: String(Number(m[2])), d: String(Number(m[3])) } : { y: "", m: "", d: "" };
}

export default function DateSelect({
  id,
  value,
  onChange,
  fromYear,
  toYear,
  newestFirst = false,
  disabled = false,
  className = "",
  selectClassName = "",
}) {
  // Partly chosen dates live here; the parent only hears about full ones.
  const [parts, setParts] = useState(() => split(value));
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    // The parent changed or cleared the value: follow it.
    setSeenValue(value);
    if (value || parts.y || parts.m || parts.d) setParts(split(value));
  }

  function update(next) {
    const merged = { ...parts, ...next };
    // Keep the day valid for the month (e.g. 31 → 30 in April).
    if (merged.d && merged.m) {
      const max = daysIn(Number(merged.y), Number(merged.m));
      if (Number(merged.d) > max) merged.d = String(max);
    }
    setParts(merged);
    const full = merged.y && merged.m && merged.d
      ? `${merged.y}-${pad(merged.m)}-${pad(merged.d)}`
      : "";
    setSeenValue(full);
    onChange(full);
  }

  const years = [];
  for (let y = fromYear; y <= toYear; y += 1) years.push(y);
  if (newestFirst) years.reverse();
  const dayCount = parts.m ? daysIn(Number(parts.y), Number(parts.m)) : 31;

  const base =
    selectClassName ||
    "w-full rounded-xl border border-black/20 bg-white px-3 py-3 text-[16px] focus:outline-none focus:border-[#F88535] focus:ring-1 focus:ring-[#F88535]";

  return (
    <div className={`grid grid-cols-[1fr_1.6fr_1.2fr] gap-2 ${className}`} role="group">
      <select
        id={id}
        aria-label="Day"
        value={parts.d}
        disabled={disabled}
        onChange={(e) => update({ d: e.target.value })}
        className={base}
      >
        <option value="">Day</option>
        {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => (
          <option key={d} value={String(d)}>
            {d}
          </option>
        ))}
      </select>
      <select
        aria-label="Month"
        value={parts.m}
        disabled={disabled}
        onChange={(e) => update({ m: e.target.value })}
        className={base}
      >
        <option value="">Month</option>
        {MONTHS.map((name, i) => (
          <option key={name} value={String(i + 1)}>
            {name}
          </option>
        ))}
      </select>
      <select
        aria-label="Year"
        value={parts.y}
        disabled={disabled}
        onChange={(e) => update({ y: e.target.value })}
        className={base}
      >
        <option value="">Year</option>
        {years.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
