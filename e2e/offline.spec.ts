import { expect, test } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
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
