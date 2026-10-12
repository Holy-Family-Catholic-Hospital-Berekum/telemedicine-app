// Playwright settings for the end-to-end tests (run through e2e/run.mjs,
// which starts the Firebase emulators first).
import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

// The website is built for the emulators (src/firebase.js USE_EMULATORS):
// a throwaway "demo-" project, no reCAPTCHA/App Check, a dummy Paystack key.
const E2E_ENV = {
  VITE_USE_EMULATORS: "1",
  // deepcode ignore HardcodedNonCryptoSecret: not a key; the emulators accept any value for a "demo-" project.
  VITE_FIREBASE_API_KEY: "demo-key",
  VITE_FIREBASE_AUTH_DOMAIN: "demo-telemedicine.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "demo-telemedicine",
  VITE_FIREBASE_STORAGE_BUCKET: "demo-telemedicine.appspot.com",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "1",
  VITE_FIREBASE_APP_ID: "1:1:web:1",
  VITE_PAYSTACK_PUBLIC_KEY: "pk_test_e2e",
  VITE_STAFF_LOGIN_PATH: "/staff-e2e",
  VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: "",
  VITE_SITE_URL: `http://localhost:${PORT}`,
};

export default defineConfig({
  testDir: "./tests",
  // The tests share one emulated database and run in order.
  workers: 1,
  fullyParallel: false,
  timeout: 4 * 60 * 1000,
  expect: { timeout: 20 * 1000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "../e2e-report" }]] : "list",
  globalSetup: "./globalSetup.mjs",
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Pixel 7"],
    // A fake camera and microphone for the video call steps.
    permissions: ["camera", "microphone"],
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    cwd: "..",
    url: `http://localhost:${PORT}`,
    timeout: 180 * 1000,
    reuseExistingServer: !process.env.CI,
    env: E2E_ENV,
  },
});
