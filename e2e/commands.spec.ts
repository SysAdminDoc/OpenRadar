import { expect, test } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
});

test("reaches a layer by what people call it, not what it is labelled", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page
    .getByRole("searchbox", { name: /Search every layer/ })
    .fill("meso");

  const rotation = page.locator('[data-command="layer:rotationTracks"]');
  await expect(rotation).toBeVisible();
  await expect(rotation).toHaveAttribute("aria-pressed", "false");
  await rotation.click();

  // The palette closes on selection rather than sitting over the result.
  await expect(
    page.getByRole("searchbox", { name: /Search every layer/ }),
  ).toBeHidden();

  // And the switch it drives is the one in the Layers panel.
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: /Rotation Tracks/ }),
  ).toBeChecked();

  // Rotation tracks are decoded natively, so a browser preview draws nothing;
  // the switch being on is what the palette is responsible for.
  await expect(pane).not.toHaveAttribute("data-layer-stack", /mrms-rotation/);
});

test("shows what is already on and turns it off again", async ({ page }) => {
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  const search = page.getByRole("searchbox", { name: /Search every layer/ });
  await search.fill("alerts");

  const alerts = page.locator('[data-command="layer:weatherAlerts"]');
  // Warnings are on by default, and the list says so rather than making you
  // toggle it to find out.
  await expect(alerts).toHaveAttribute("aria-pressed", "true");
  await alerts.click();

  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page
    .getByRole("searchbox", { name: /Search every layer/ })
    .fill("alerts");
  await expect(
    page.locator('[data-command="layer:weatherAlerts"]'),
  ).toHaveAttribute("aria-pressed", "false");
});

test("opens a panel and changes the map type from the same list", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page
    .getByRole("searchbox", { name: /Search every layer/ })
    .fill("hurdat");
  await page.locator('[data-command="surface:history"]').click();
  await expect(page.getByText("Storm history")).toBeVisible();

  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page
    .getByRole("searchbox", { name: /Search every layer/ })
    .fill("aerial");
  const style = page.locator('[data-command^="style:"]').first();
  await expect(style).toBeVisible();
  await style.click();
  await expect(
    page.getByRole("searchbox", { name: /Search every layer/ }),
  ).toBeHidden();
});

test("says so when nothing matches", async ({ page }) => {
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  const search = page.getByRole("searchbox", { name: /Search every layer/ });

  // The whole list until something is typed.
  await expect(page.locator("[data-command-count]")).not.toHaveAttribute(
    "data-command-count",
    "0",
  );

  await search.fill("biscuits");
  await expect(page.getByText(/Nothing here matches that/)).toBeVisible();
  await expect(page.locator("[data-command-count]")).toHaveAttribute(
    "data-command-count",
    "0",
  );
});
