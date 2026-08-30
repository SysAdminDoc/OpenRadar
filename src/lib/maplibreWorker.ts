import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// MapLibre 6 uses an ESM worker. Vite emits this as one same-origin module,
// which keeps it compatible with the desktop content security policy.
setWorkerUrl(workerUrl);
