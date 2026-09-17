export default function StatTile({ label, value, icon: Icon, tone = 'default' }) {
  const toneIconColor = { default: '#0095D9', live: '#F88535' }[tone];
  const toneValueColor = { default: '#12242C', live: '#F88535' }[tone];

  return (
    <div className="flex items-center gap-2 border-r border-[#DCE6EC] px-3 py-3 last:border-r-0 sm:gap-3 sm:px-5 sm:py-4">
      <Icon size={16} strokeWidth={1.75} className="shrink-0 sm:size-[18px]" style={{ color: toneIconColor }} />
      <div>
        <p className="text-lg font-semibold leading-none sm:text-2xl" style={{ color: toneValueColor }}>
          {value}
        </p>
        <p className="mt-1 text-[11px] leading-tight text-[#5C6B72] sm:text-xs">{label}</p>
      </div>
    </div>
  );
}
