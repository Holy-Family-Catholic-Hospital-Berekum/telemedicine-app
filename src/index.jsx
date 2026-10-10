import { createRoot } from "react-dom/client";
// Self-hosted fonts (variable weights, latin subset loaded on demand).
import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";
import "@fontsource-variable/fraunces";
import "./index.css";
// Catches Chrome's "add to home screen" event as early as possible.
import "./installPrompt";
import App from "./App";
const root = createRoot(document.getElementById("root"));
import { BrowserRouter } from "react-router-dom";

root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
