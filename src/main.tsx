import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NoGpu } from "./components/NoGpu";
import "./index.css";
import { ensureLanguage, setLanguage } from "./i18n";
import { gpuSupport } from "./lib/gpu";
import { loadSettings } from "./lib/settings";
import { primeTileCache } from "./lib/tileCache";

// Worked out once, before the map asks for anything, so the first screen of
// tiles is kept as well as the ones after it.
void primeTileCache();

// MapLibre 6 needs WebGL2, so a machine without it has no map. Saying which
// setting to look at beats an exception from inside the renderer.
const drawable = gpuSupport().webgl2;
const root = createRoot(document.getElementById("root")!);

if (drawable) {
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
} else {
  // App is what normally applies the saved language, and it is not mounting.
  // Reading it here is the difference between explaining the problem and
  // explaining it in a language the reader may not have.
  void loadSettings()
    .then(async (settings) => {
      await ensureLanguage(settings.language);
      setLanguage(settings.language);
    })
    .catch(() => {})
    .finally(() => {
      root.render(
        <StrictMode>
          <ErrorBoundary>
            <NoGpu />
          </ErrorBoundary>
        </StrictMode>,
      );
    });
}
