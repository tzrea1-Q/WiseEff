import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initThemeController } from "./application/theme/themeController";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import "./styles.css";

// Apply the persisted theme before first paint so a stored dark preference
// does not flash light. Defaults to light until the dark theme ships.
initThemeController();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
