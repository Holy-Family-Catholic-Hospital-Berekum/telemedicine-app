import { createRoot } from "react-dom/client";
import App from "./app";
const root = createRoot(document.getElementById("root"));
import { BrowserRouter } from "react-router-dom";

root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
