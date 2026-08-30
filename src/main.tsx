import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NoGpu } from "./components/NoGpu";
import "./index.css";
import { gpuSupport } from "./lib/gpu";
import { primeTileCache } from "./lib/tileCache";

// Worked out once, before the map asks for anything, so the first screen of
// tiles is kept as well as the ones after it.
void primeTileCache();

// MapLibre 6 needs WebGL2, so a machine without it has no map. Saying which
// setting to look at beats an exception from inside the renderer.
const drawable = gpuSupport().webgl2;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>{drawable ? <App /> : <NoGpu />}</ErrorBoundary>
  </StrictMode>,
);
