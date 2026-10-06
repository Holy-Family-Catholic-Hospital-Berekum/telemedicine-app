import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
const root = createRoot(document.getElementById("root"));
import { BrowserRouter } from "react-router-dom";

root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
