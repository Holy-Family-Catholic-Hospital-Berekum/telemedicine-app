const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
const Svg = ({ children, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>{children}</svg>
);

export const IconMail = (p) => <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></Svg>;
export const IconLock = (p) => <Svg {...p}><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 018 0v3.5" /></Svg>;
export const IconUser = (p) => <Svg {...p}><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20c1.5-4 4-5.5 7.5-5.5s6 1.5 7.5 5.5" /></Svg>;
export const IconPhone = (p) => <Svg {...p}><path d="M5 4h3l2 5-2.5 1.5a12 12 0 006 6L15 14l5 2v3a2 2 0 01-2.2 2A17 17 0 013 6.2 2 2 0 015 4z" /></Svg>;
export const IconEye = (p) => <Svg {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></Svg>;
export const IconEyeOff = (p) => <Svg {...p}><path d="M3 3l18 18" /><path d="M10.6 5.2A10.6 10.6 0 0112 5c6.5 0 10 7 10 7a15.5 15.5 0 01-3.4 4.3M6.6 6.6A15.6 15.6 0 002 12s3.5 7 10 7a9.9 9.9 0 004.4-1" /><path d="M9.9 9.9a3 3 0 004.2 4.2" /></Svg>;
export const IconAlert = (p) => <Svg {...p}><path d="M12 3l10 18H2L12 3z" /><path d="M12 9.5v4.5M12 17h.01" /></Svg>;
export const IconCheckCircle = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.3 2.3L16 10" /></Svg>;
export const IconArrowLeft = (p) => <Svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>;
