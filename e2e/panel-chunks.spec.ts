import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";
import { SURFACES } from "./support/surfaces";

/**
 * A panel that arrives over the network, and what happens when it does not.
 *
 * Ten panels are behind a `lazy`, so opening one is a fetch that can fail on
 * a flaky connection the way any other fetch can. Every one of them used to
 * throw past a `Suspense` with a `null` fallback to the boundary in
 * `main.tsx`, which unmounts the workspace: the reader lost the map, the
 * timeline and the command bar because a panel they may never open again did
 * not download. The two cases below are that failure and the wait before it.
 */

const APP = { name: "Interactive weather map" } as const;

async function start(page: Page) {
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application", APP)).toBeVisible();
}

test("a panel whose chunk never arrives leaves the workspace standing", async ({
  page,
}) => {
  // The dev server serves the module under its own source path, which is what
  // the chunk is at this stage of the build. A refused request is the same
  // rejection a dropped connection produces.
  await page.route("**/RoutePanel*", (route) => route.abort());
  await start(page);

  await SURFACES.route.open(page);

  const panel = page.getByRole("dialog", { name: "Route" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/could not be fetched/)).toBeVisible();

  // The point of the whole item. Everything the reader was looking at is
  // still there, and the whole-window recovery screen is not.
  await expect(page.getByRole("application", APP)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Commands", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("The interface could not finish drawing."),
  ).toHaveCount(0);

  // And it is a panel, so it closes like one rather than stranding the reader
  // in a frame with a reload button as the only way out.
  await panel.getByRole("button", { name: /Close/ }).click();
  await expect(panel).toHaveCount(0);
});

test("the wait for a chunk holds the room the panel is about to take", async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/RoutePanel*", async (route) => {
    await held;
    await route.continue();
  });
  await start(page);

  await SURFACES.route.open(page);

  // The map chrome moves out of a right-hand panel's way the moment the
  // button is pressed. With a `null` fallback it moved around nothing for as
  // long as the chunk took, measured at 1,100 ms against 100 ms for a panel
  // that ships in the main bundle.
  // `data-panel-waiting`, not `aria-busy`: a panel of its own can be busy
  // through `PanelShell`, so a selector on that alone would match the panel
  // once it arrived and pass with no placeholder at all.
  const placeholder = page.locator("[data-panel-waiting]");
  await expect(placeholder).toBeVisible();
  await expect(placeholder).toHaveText(/Route/);
  const waiting = await placeholder.boundingBox();
  expect(waiting?.width ?? 0).toBeGreaterThan(200);

  release();

  const panel = page.getByRole("dialog", { name: "Route" });
  await expect(panel).toBeVisible();
  const arrived = await panel.boundingBox();
  // The same room, so nothing jumps when the panel finally lands.
  expect(Math.abs((arrived?.width ?? 0) - (waiting?.width ?? 0))).toBeLessThan(
    2,
  );
});
