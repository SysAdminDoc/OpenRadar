import { expect, test, type Page } from "@playwright/test";
import {
  ridgeCapabilities,
  routeWorkspace,
  stubHost,
} from "./support/fixtures";
import { en } from "../src/i18n/en";

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

/**
 * One answer for the whole workspace, rather than the radar's alone.
 *
 * Before this only the timeline knew. Every overlay went on polling and
 * failing into the log, the watch's health line said its sources were not
 * answering rather than that the machine could not see, and the only hint on
 * screen was "showing the last view" on the radar, which says nothing about
 * the warnings drawn over it.
 */
test.describe("with no network at all", () => {
  test("says so once, for everything", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => false,
      });
    });
    await page.goto("/?testMode=1");
    await expect(
      page.getByRole("application", { name: "Interactive weather map" }),
    ).toBeVisible();

    // The chrome says the machine has no network, beside the radar's own
    // freshness rather than instead of it: "showing the last view" is about
    // the radar loop, and the warnings and outlooks drawn over it are just as
    // old with nothing saying so.
    await expect(page.locator("[data-offline]")).toContainText("Offline for");

    // And the watch says why it is not watching, in the place a reader goes
    // to check on it. "Not reaching the service" reads as a service that is
    // down and sends them looking in the wrong place.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    const line = page.locator("[data-watch-offline]");
    await line.scrollIntoViewIfNeeded();
    await expect(line).toContainText("no network");
    await expect(page.locator("[data-watch-failing]")).toHaveCount(0);
  });

  test("asks for nothing at all, from any of its timers", async ({ page }) => {
    // Not "the overlays stop", which was the first attempt: the workspace has
    // a dozen timers of its own — the radar loop, the warnings, the
    // lightning, the wind, the storm cells, the national grids, the site
    // listing, the watch, the ambient readout, ProbSevere, hydrometeor
    // classification, the station status — and gating one of them left the
    // other eleven asking and failing every thirty to a hundred and twenty
    // seconds. This is the assertion that catches the next one somebody
    // writes without thinking about it.
    // The workspace this file's `beforeEach` opened is still running and
    // still fetching, online. Stopped before anything is recorded, or its
    // requests land in the count and the test fails for a page that is not
    // the one under test.
    await page.goto("about:blank");

    const outbound: string[] = [];
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      const host = new URL(url).hostname;
      if (host === "127.0.0.1" || host === "localhost") {
        await route.continue();
        return;
      }
      // Map tiles are not one of these. They go through the `cached` scheme,
      // which on the desktop IS the local cache: asking for one with no
      // network is how the last view gets drawn at all, and stopping them
      // would take away the feature this whole area exists for. Every other
      // ask is a timer that should have been holding off.
      // The address is wrapped in the cache scheme's `u=` parameter, so the
      // real one has to come back out before it can be read.
      const asked = new URL(url).searchParams.get("u") ?? url;
      if (!asked.includes("request=GetMap")) outbound.push(asked);
      await route.abort("connectionfailed");
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => false,
      });
    });
    await page.goto("/?testMode=1");
    await expect(
      page.getByRole("application", { name: "Interactive weather map" }),
    ).toBeVisible();
    // Long enough for the fastest timer in the app to have come round twice.
    await page.waitForTimeout(3000);

    expect(
      outbound,
      `asked for ${outbound.length} things with no network`,
    ).toEqual([]);
  });

  test("keeps saying so on a captive portal, where the browser lies", async ({
    page,
  }) => {
    // The hotel wifi case. `navigator.onLine` is true, every request fails,
    // and clearing the line on that event told a reader everything was fine
    // while putting the workspace straight back into polling and failing.
    // Only something coming back clears it.
    await page.goto("about:blank");
    await page.route("**/*", async (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === "127.0.0.1" || host === "localhost") {
        await route.continue();
        return;
      }
      await route.abort("connectionfailed");
    });
    await page.addInitScript(() => {
      let online = false;
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => online,
      });
      (window as unknown as { __portal: () => void }).__portal = () => {
        online = true;
        window.dispatchEvent(new Event("online"));
      };
    });
    await page.goto("/?testMode=1");
    await expect(
      page.getByRole("application", { name: "Interactive weather map" }),
    ).toBeVisible();
    await expect(page.locator("[data-offline]")).toContainText("Offline for");

    // The browser now says there is a network. Nothing can be reached.
    await page.evaluate(() =>
      (window as unknown as { __portal: () => void }).__portal(),
    );
    await page.waitForTimeout(1500);

    // Still saying it, because nothing has come back.
    await expect(page.locator("[data-offline]")).toContainText("Offline for");
  });

  test("stops asking, and asks again the moment it can", async ({ page }) => {
    // Every switched-on overlay had its own thirty-second timer, and each one
    // went on failing into the log for as long as the machine was off the
    // network.
    const asked: string[] = [];
    // Both spellings. With the native side faked, the app sends everything
    // through its own `cached` scheme, so a route on the real host alone
    // records nothing and the test passes for the wrong reason.
    const empty = JSON.stringify({ type: "FeatureCollection", features: [] });
    for (const pattern of [
      "https://api.weather.gov/**",
      "http://cached.localhost/**",
    ]) {
      await page.route(pattern, async (route) => {
        const url = route.request().url();
        if (url.includes("api.weather.gov")) asked.push(url);
        await route.fulfill({
          contentType: "application/geo+json",
          body: empty,
        });
      });
    }
    await page.addInitScript(() => {
      let online = false;
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => online,
      });
      (window as unknown as { __goOnline: () => void }).__goOnline = () => {
        online = true;
        window.dispatchEvent(new Event("online"));
      };
    });
    await page.goto("/?testMode=1");
    await expect(
      page.getByRole("application", { name: "Interactive weather map" }),
    ).toBeVisible();
    await page.waitForTimeout(1500);
    expect(asked, "asked for an overlay with no network").toEqual([]);

    // And the first thing that happens when the network comes back is an
    // ask, rather than up to thirty seconds of a map nobody has told.
    await page.evaluate(() =>
      (window as unknown as { __goOnline: () => void }).__goOnline(),
    );
    await expect.poll(() => asked.length).toBeGreaterThan(0);
    await expect(page.locator("[data-offline]")).toHaveCount(0);
  });
});

test("says out loud that the machine went offline, and that it came back", async ({
  page,
}) => {
  // The greyed chip in the top bar is the whole of what the workspace said,
  // so a reader who cannot see it heard nothing at all: every layer went on
  // polling and failing into the log, and the only hint was a line about the
  // radar that says nothing about the warnings drawn over it.
  const toasts = page.locator(".toast-host");
  await expect(toasts).toHaveCount(1);

  // The real switch, not a dispatched event: `online.ts` reads
  // `navigator.onLine`, and an event alone leaves it saying the machine can
  // still see, so nothing changes and nothing is announced.
  await page.context().setOffline(true);
  await expect(toasts.getByText(en["notice.offline"])).toBeVisible();

  await page.context().setOffline(false);
  // Coming back is only a claim until something answers, which is what
  // clears the line, so this waits on a fetch rather than on the flag.
  await expect(toasts.getByText(en["notice.online"])).toBeVisible({
    timeout: 20_000,
  });
});

test("a stub that answers nothing fails the request rather than hanging", async ({
  page,
}) => {
  // A handler that falls off its last branch leaves the request open for the
  // life of the page, and the spec then fails by timing out on whatever that
  // request feeds: somewhere else entirely, with a message about the wrong
  // thing. That is most of what AUD-247 cost, so it cannot be allowed to go
  // unnoticed again.
  await stubHost(page, "https://silent.example/**", async () => {
    // Deliberately answers nothing at all.
  });
  const status = await page.evaluate(async () => {
    const reply = await fetch("https://silent.example/anything.json");
    return { code: reply.status, body: await reply.text() };
  });
  expect(status.code).toBe(599);
  expect(status.body).toContain("https://silent.example/anything.json");
});

test("an unrecognised path answers with what was asked for", async ({
  page,
}) => {
  // The mesonet handler answered JSON for every path it did not know,
  // including the icon sheet a placefile points at. A decoder handed JSON
  // where it wanted a PNG fails in a way that reads as the feature being
  // broken rather than as the fixture being thin.
  const types = await page.evaluate(async () => {
    const of = async (url: string) =>
      (await fetch(url)).headers.get("content-type");
    return {
      image: await of("https://mesonet.agron.iastate.edu/pictures/sheet.png"),
      data: await of("https://mesonet.agron.iastate.edu/nothing/at/all"),
    };
  });
  expect(types.image).toContain("image/png");
  expect(types.data).toContain("application/json");
});
