// validators.js — shared input validation for auth forms.
// Kept framework-agnostic and dependency-free so it's easy to unit test.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Accepts Ghanaian numbers in local (0XXXXXXXXX) or international
// (+233XXXXXXXXX) format. Loosen/replace if patients outside Ghana sign up.
const GHANA_PHONE_RE = /^(?:\+233|0)[2357][0-9]{8}$/;

export function isValidEmail(email) {
  return EMAIL_RE.test(String(email).trim());
}

export function isValidPhone(phone) {
  return GHANA_PHONE_RE.test(String(phone).trim().replace(/\s+/g, ""));
}

// Deliberately stricter than the Firebase Auth minimum (6 chars) —
// this is a health platform, so we ask for more. Returns a list of
// unmet rules; an empty array means the password passes.
export function passwordIssues(password) {
  const issues = [];
  if (password.length < 10) issues.push("At least 10 characters");
  if (!/[a-z]/.test(password)) issues.push("A lowercase letter");
  if (!/[A-Z]/.test(password)) issues.push("An uppercase letter");
  if (!/[0-9]/.test(password)) issues.push("A number");
  if (!/[^A-Za-z0-9]/.test(password)) issues.push("A symbol");
  return issues;
}

export function passwordStrengthLabel(password) {
  const issuesLeft = passwordIssues(password).length;
  if (!password) return { label: "", score: 0 };
  if (issuesLeft >= 4) return { label: "Weak", score: 1 };
  if (issuesLeft >= 2) return { label: "Fair", score: 2 };
  if (issuesLeft >= 1) return { label: "Good", score: 3 };
  return { label: "Strong", score: 4 };
}

export function isValidName(name) {
  return String(name).trim().length >= 2;
}
