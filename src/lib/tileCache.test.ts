import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CACHED_HOSTS,
  cachedUrl,
  primeTileCache,
  resetTileCache,
} from "./tileCache";

vi.mock("./settings", async () => {
  const actual =
    await vi.importActual<typeof import("./settings")>("./settings");
  return { ...actual, isDesktopRuntime: () => desktop };
});

vi.mock("@tauri-apps/api/core", () => ({
  // What Tauri hands back on Windows. The trailing marker is what the caller
  // slices off to find the scheme and host.
  convertFileSrc: (path: string, scheme: string) =>
    `http://${scheme}.localhost/${path}`,
}));

let desktop = true;

afterEach(() => {
  resetTileCache();
  desktop = true;
});

describe("routing the map's requests through the native side", () => {
  it("leaves everything alone until it knows how to spell the scheme", () => {
    const url = "https://tilecache.rainviewer.com/v2/radar/0/256/1/2/3/0_0.png";
    expect(cachedUrl(url)).toBe(url);
  });

  it("keeps the whole address, query string and all", async () => {
    await primeTileCache();
    const wms =
      "https://geo.weather.gc.ca/geomet?service=WMS&request=GetMap&layers=RADAR_1KM_RRAI&time=2026-08-30T12:00:00Z";
    const routed = cachedUrl(wms);
    expect(routed.startsWith("http://cached.localhost/?u=")).toBe(true);
    // Read back the way the native side reads it. A WMS address carries its
    // own parameters, and an unencoded one would end at the first ampersand:
    // the request that arrived would name no layer and no time.
    expect(new URL(routed).searchParams.get("u")).toBe(wms);
  });

  it("routes every host it claims to cache", async () => {
    await primeTileCache();
    for (const host of CACHED_HOSTS) {
      expect(cachedUrl(`https://${host}/tile.png`), host).toContain(
        "cached.localhost",
      );
    }
    // And a subdomain of one, which is how the ArcGIS services are addressed.
    expect(cachedUrl("https://tiles.services3.arcgis.com/a.png")).toContain(
      "cached.localhost",
    );
  });

  it("leaves alone anything it has no business fetching", async () => {
    await primeTileCache();
    // Not on the list.
    const elsewhere = "https://example.test/tile.png";
    expect(cachedUrl(elsewhere)).toBe(elsewhere);
    // A lookalike host, which must not match by suffix alone.
    const lookalike = "https://tiles.openfreemap.org.example.test/tile.png";
    expect(cachedUrl(lookalike)).toBe(lookalike);
    // Not the web: the blank tile the request budget hands back, the locally
    // drawn MRMS tiles, and the app's own assets.
    for (const url of [
      "data:image/png;base64,iVBORw0KGgo=",
      "http://mrms.localhost/composite/3/1/2.png",
      "/fonts/glyphs.pbf",
      "http://tiles.openfreemap.org/styles/dark",
    ]) {
      expect(cachedUrl(url), url).toBe(url);
    }
  });

  it("does nothing at all in a browser", async () => {
    desktop = false;
    await primeTileCache();
    const url = "https://tiles.openfreemap.org/styles/dark";
    expect(cachedUrl(url)).toBe(url);
  });
});
