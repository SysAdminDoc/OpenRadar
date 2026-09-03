import { afterEach, describe, expect, it, vi } from "vitest";
import { gpuSupport, resetGpuSupport } from "./gpu";

afterEach(() => {
  resetGpuSupport();
  vi.restoreAllMocks();
});

describe("what the machine can draw with", () => {
  it("reports no WebGL2 when a context cannot be made", () => {
    // MapLibre 6 has no software fallback, so this is the difference between
    // a window that explains itself and an exception from inside the renderer.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(gpuSupport()).toEqual({ webgl2: false, renderer: null });
  });

  it("reports no WebGL2 when asking for one throws", () => {
    // Some locked-down environments throw rather than answering null.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => {
        throw new Error("blocked");
      },
    );
    expect(gpuSupport().webgl2).toBe(false);
  });

  it("names the driver and lets go of the context it borrowed", () => {
    const lose = vi.fn();
    const context = {
      getExtension: (name: string) =>
        name === "WEBGL_lose_context" ? { loseContext: lose } : null,
      getParameter: () => "Test Renderer 9000",
      RENDERER: 0x1f01,
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as RenderingContext,
    );

    expect(gpuSupport()).toEqual({
      webgl2: true,
      renderer: "Test Renderer 9000",
    });
    // The probe must not keep a context the map could have had.
    expect(lose).toHaveBeenCalled();
  });

  it("asks for the context the map will ask for", () => {
    // The gate in front of the whole app. A plain WebGL2 context can succeed
    // on a driver that then refuses the map's own request, and asking an
    // easier question than the one that has to be answered lets a machine
    // through to a screen it cannot draw. The map wants the drawing buffer
    // kept, because that is what a saved picture is read out of.
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    gpuSupport();
    expect(getContext).toHaveBeenCalledWith("webgl2", {
      preserveDrawingBuffer: true,
    });
  });

  it("asks once and remembers", () => {
    // The answer cannot change without a reload, and each ask allocates a
    // context.
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    gpuSupport();
    gpuSupport();
    gpuSupport();
    expect(getContext).toHaveBeenCalledTimes(1);
  });
});
