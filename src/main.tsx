import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
import { primeTileCache } from "./lib/tileCache";

// Worked out once, before the map asks for anything, so the first screen of
// tiles is kept as well as the ones after it.
void primeTileCache();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
