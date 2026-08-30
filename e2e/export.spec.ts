import { expect, test } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
});

test("writes a still of the current view", async ({ page }) => {
  await page.getByRole("button", { name: "Export", exact: true }).click();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export image" }).click();
  const file = await download;

  expect(file.suggestedFilename()).toMatch(/^openradar-.*\.png$/);
  const path = await file.path();
  const bytes = await import("node:fs/promises").then((fs) =>
    fs.readFile(path),
  );
  // A PNG, and big enough to be a picture rather than an empty canvas.
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.byteLength).toBeGreaterThan(2000);
  await expect(page.getByText(/\.png saved/)).toBeVisible();

  // The caption is part of the picture, not chrome drawn around it.
  const captionPixels = await page.evaluate(async (base64: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) return 0;
    context.drawImage(image, 0, 0);
    const band = context.getImageData(0, image.height - 90, 400, 90).data;
    let bright = 0;
    for (let at = 0; at < band.length; at += 4) {
      if (band[at] > 180 && band[at + 1] > 180 && band[at + 2] > 180) {
        bright += 1;
      }
    }
    return bright;
  }, bytes.toString("base64"));
  expect(captionPixels).toBeGreaterThan(80);
});

// The still test proves the caption is burned in; reading it back out of a
// WebM would mean decoding video, so this covers the recording itself.
test("records the loop as a WebM the size cap allows", async ({ page }) => {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Export loop \(3 frames\)/ }),
  ).toBeVisible();

  const download = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: /Export loop/ }).click();
  await expect(page.getByText(/Recording frame/)).toBeVisible();
  const file = await download;

  expect(file.suggestedFilename()).toMatch(/^openradar-loop-.*\.webm$/);
  const path = await file.path();
  const bytes = await import("node:fs/promises").then((fs) =>
    fs.readFile(path),
  );
  // The Matroska magic every WebM starts with, and well under the size cap.
  expect(bytes.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
  expect(bytes.byteLength).toBeLessThan(20 * 1024 * 1024);
  // A recording with no frames in it is only headers. The test map is a flat
  // dark canvas, so three frames of it compress hard but still land well past
  // an empty container.
  expect(bytes.byteLength).toBeGreaterThan(2_500);
  await expect(page.getByText(/.webm saved/)).toBeVisible();
});
