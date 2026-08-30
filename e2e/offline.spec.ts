import { expect, test, type Page } from "@playwright/test";
import { ridgeCapabilities, routeWorkspace } from "./support/fixtures";

/**
 * What the app sees when it is running inside Tauri: enough of the internals
 * for isDesktopRuntime to answer yes and for the cached scheme to be spelled
 * the way Windows spells it. Without this the app is a plain web page, the
 * cache is not in the picture at all, and this file would be testing
 * navigator.onLine and nothing else.
 */
async function fakeNativeSide(page: Page) {
  await page.addInitScript(() => {
    (
      window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
    ).__TAURI_INTERNALS__ = {
      convertFileSrc: (path: string, scheme: string) =>
        `http://${scheme}.localhost/${path}`,
      invoke: async (command: string) => {
        // Only the palette and the local decoders are asked for here, and
        // none of them is what this file is about.
        if (command === "mrms_products") return [];
        throw new Error(`${command} is not stubbed`);
      },
      transformCallback: (callback: unknown) => callback,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await fakeNativeSide(page);
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
});

test("routes what it fetches through the native cache", async ({ page }) => {
  // Every request the map makes for a host worth keeping goes through the
  // scheme, which is what puts the bytes on disk in the first place. If this
  // stops happening there is no cache to fall back to and the rest of this
  // file is testing a flag.
  const routed: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("http://cached.localhost/")) {
      routed.push(request.url());
    }
  });
  await page.reload();
  await expect(
    page.getByLabel("Radar animation", { exact: true }),
  ).toContainText("radar frames");

  expect(routed.length).toBeGreaterThan(0);
  // And the address it names is the real one, whole.
  const inner = new URL(routed[0]).searchParams.get("u");
  expect(inner).toMatch(/^https:\/\//);
});

test("says the loop is the last one it has rather than passing it off as live", async ({
  page,
  context,
}) => {
  const timeline = page.getByLabel("Radar animation", { exact: true });
  await expect(timeline).toContainText("radar frames");
  await expect(timeline).not.toContainText("Showing the last view");

  // The network goes. The frames on screen are still worth showing, and the
  // tiles under them come off the disk on the desktop build, so the timeline
  // has to say what it is showing.
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(timeline).toContainText("Showing the last view");
  await expect(timeline).toContainText("radar frames");

  // And the map is still a map: the loop did not empty out.
  await expect(
    page.locator(".radar-timeline input[type='range']"),
  ).toBeEnabled();

  // Back on the network, the next refresh puts it back on live.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(timeline).not.toContainText("Showing the last view");
});

test("says so when the native side answers from its own cache", async ({
  page,
  context,
}) => {
  const timeline = page.getByLabel("Radar animation", { exact: true });
  await expect(timeline).toContainText("radar frames");
  await expect(timeline).not.toContainText("Showing the last view");

  // The machine still believes it has a network and the request still
  // succeeds. What has changed is that the native side answered out of its
  // cache and said so on the way past, which is the only signal that knows.
  await page.route("http://cached.localhost/**", async (route) => {
    const inner = new URL(route.request().url()).searchParams.get("u");
    if (!inner) {
      await route.fulfill({ status: 400, body: "no address" });
      return;
    }
    // The capabilities document is answered here rather than sent back to
    // its own host, because the header that says how old the bytes are has
    // to be on the response the page actually reads. A redirect would carry
    // it away.
    if (inner.includes("opengeo.ncep.noaa.gov")) {
      await route.fulfill({
        contentType: "application/xml",
        headers: {
          "x-openradar-age": "900",
          // The page is on another origin, so a header it is meant to read has
          // to be exposed. The native handler does the same, and without it
          // the age is invisible and the loop passes for live.
          "access-control-allow-origin": "*",
          "access-control-expose-headers": "X-OpenRadar-Age",
        },
        body: ridgeCapabilities,
      });
      return;
    }
    await route.fulfill({ status: 302, headers: { location: inner } });
  });

  // The refresh that would pick this up is five minutes away, so the loop is
  // nudged rather than waited on: going offline and back is what a laptop lid
  // does, and coming back asks again straight away. The wait between the two
  // matters, or the pair collapses into one render and nothing was ever off.
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(timeline).toContainText("Showing the last view");
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect(timeline).toContainText("Showing the last view", {
    timeout: 15_000,
  });
});
