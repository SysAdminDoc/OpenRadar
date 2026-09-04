import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The map has to measure itself again the first time its window is shown.
 *
 * A build that starts with Windows opens to the tray, so the map is built
 * inside a window nobody has shown yet. WebView2 152 hands such a host a
 * viewport of about seventy by forty pixels rather than the window's own
 * size (WebView2Feedback #5689), and a map built at that size keeps it: the
 * resize observer watches the container, and the container does not change
 * when the window it sits in appears. The reader opens the tray to a map
 * drawn in the corner of its own canvas.
 *
 * Read out of the source, the way `placefileIcons.test.ts` reads the same
 * file, because neither a browser nor a unit test can reproduce it: no
 * browser can be told to hand back a viewport smaller than its own window,
 * and the whole defect is that nothing else fires. What can be held is that
 * the call exists and is wired to becoming visible. The other half, watching
 * a real tray launch on a desktop session, is in `Roadmap_Blocked.md` with
 * the other checks that need one.
 */
const viewport = readFileSync(
  join(process.cwd(), "src", "components", "MapViewport.tsx"),
  "utf8",
);

describe("a map built inside a window nobody has shown yet", () => {
  it("measures itself again when the window becomes visible", () => {
    // The add, specifically. Searching for the bare word matches the removal
    // in the cleanup too, so deleting the registration and keeping the
    // teardown would pass: that mutation was tried and it did.
    const at = viewport.indexOf('document.addEventListener("visibilitychange"');
    expect(at, "nothing listens for the window being shown").toBeGreaterThan(0);
    // The listener and the resize have to be the same lane: a
    // `visibilitychange` handler that does something else would pass a bare
    // search for the word.
    const handler = viewport.slice(Math.max(0, at - 400), at + 100);
    expect(handler).toContain('document.visibilityState === "visible"');
    expect(handler).toContain("map.resize()");
  });

  it("keeps the observer that covers every later change", () => {
    // The visibility call is for the one moment the observer cannot see.
    // Losing the observer to it would stop the map following the window on
    // every ordinary resize after that.
    expect(viewport).toContain("new ResizeObserver(() => map.resize())");
  });

  it("takes the listener off when the map goes", () => {
    // A handler left on the document outlives the map it closes over, and
    // calls resize on one that has been removed.
    const off = viewport.indexOf(
      'document.removeEventListener("visibilitychange"',
    );
    expect(off, "the listener is never removed").toBeGreaterThan(0);
  });
});
