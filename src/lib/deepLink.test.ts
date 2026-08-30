import { describe, expect, it } from "vitest";
import { deepLinkUrl, viewFromDeepLink, webLinkUrl } from "./deepLink";
import { DEFAULT_SETTINGS } from "./settings";

const view = {
  camera: {
    center: [-96.8, 32.78] as [number, number],
    zoom: 7.25,
    bearing: 18,
    pitch: 42,
  },
  projection: "globe" as const,
};

describe("share links", () => {
  it("writes a link the desktop app can be opened with", () => {
    expect(deepLinkUrl(view)).toBe(
      "openradar://view?lon=-96.80000&lat=32.78000&zoom=7.25&bearing=18.0&pitch=42.0&projection=globe",
    );
  });

  it("writes a plain web address for the browser preview", () => {
    expect(webLinkUrl(view, "http://127.0.0.1:1420/?old=1#frag")).toBe(
      "http://127.0.0.1:1420/?lon=-96.80000&lat=32.78000&zoom=7.25&bearing=18.0&pitch=42.0&projection=globe",
    );
  });

  it("round-trips a shared view", () => {
    const parsed = viewFromDeepLink(deepLinkUrl(view), DEFAULT_SETTINGS.camera);
    expect(parsed).toEqual({
      camera: {
        center: [-96.8, 32.78],
        zoom: 7.25,
        bearing: 18,
        pitch: 42,
      },
      projection: "globe",
    });
  });

  it("refuses anything that is not one of our view links", () => {
    const fallback = DEFAULT_SETTINGS.camera;
    expect(
      viewFromDeepLink("https://example.test/view?lon=1", fallback),
    ).toBeNull();
    expect(viewFromDeepLink("openradar://settings?lon=1", fallback)).toBeNull();
    expect(viewFromDeepLink("openradar://view", fallback)).toBeNull();
    expect(viewFromDeepLink("not a url", fallback)).toBeNull();
  });

  it("clamps a link that carries impossible numbers", () => {
    const parsed = viewFromDeepLink(
      "openradar://view?lon=999&lat=-999&zoom=80&bearing=-900&pitch=100",
      DEFAULT_SETTINGS.camera,
    );
    expect(parsed?.camera).toEqual({
      center: [180, -85],
      zoom: 15,
      bearing: -180,
      pitch: 75,
    });
    expect(parsed?.projection).toBe("mercator");
  });
});
