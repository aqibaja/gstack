import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PopupApp } from "./PopupApp";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Missing popup mount root");
}

createRoot(container).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>
);
