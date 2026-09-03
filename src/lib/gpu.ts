/**
 * What the machine can draw with.
 *
 * MapLibre 6 dropped WebGL1, so a machine that cannot make a WebGL2 context
 * has no map at all. That is not a rare corner: a virtual machine with no
 * passthrough, a WebView2 with hardware acceleration turned off, and a remote
 * desktop session all land there, and the failure arrives as an exception from
 * deep inside the map with nothing in it a person could act on.
 *
 * Asking first costs one throwaway canvas and lets the app say which setting
 * to look at.
 */

let checked: GpuSupport | null = null;

export interface GpuSupport {
  /** Whether a WebGL2 context could be created at all. */
  webgl2: boolean;
  /** What the driver calls itself, when it will say. */
  renderer: string | null;
}

/**
 * Looks once and remembers. The answer cannot change without a reload, and the
 * probe allocates a context, so repeating it is waste.
 */
export function gpuSupport(): GpuSupport {
  if (checked) return checked;
  checked = probe();
  return checked;
}

function probe(): GpuSupport {
  try {
    const canvas = document.createElement("canvas");
    // The same attributes the map asks for. A plain context can succeed where
    // the map's request fails, and this probe is the gate in front of the
    // whole app: asking an easier question than the one that has to be
    // answered lets a machine through to a screen it cannot draw.
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
    if (!gl) return { webgl2: false, renderer: null };

    // Both spellings: the unmasked name is the useful one and needs an
    // extension, and browsers have been narrowing what it reports.
    let renderer: string | null = null;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    if (debug) {
      const value: unknown = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
      if (typeof value === "string") renderer = value;
    }
    if (!renderer) {
      const value: unknown = gl.getParameter(gl.RENDERER);
      if (typeof value === "string") renderer = value;
    }

    // A probe context held open is one the map cannot have.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { webgl2: true, renderer };
  } catch {
    return { webgl2: false, renderer: null };
  }
}

/** Only for tests, which need to ask again after changing the answer. */
export function resetGpuSupport() {
  checked = null;
}
