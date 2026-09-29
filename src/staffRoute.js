// Read from the environment at build time. There is deliberately no
// fallback default: if the variable is missing, the staff route is not
// registered at all rather than falling back to a value in source code.
const raw = import.meta.env.VITE_STAFF_LOGIN_PATH?.trim();

export const STAFF_LOGIN_PATH = raw
  ? raw.startsWith("/")
    ? raw
    : `/${raw}`
  : null;
