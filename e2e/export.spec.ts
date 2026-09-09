import { expect } from "@playwright/test";
import { routeWorkspace, test } from "./support/fixtures";

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
  await page.getByRole("button", { name: "Export picture" }).click();
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

test("credits the map that was actually under the weather", async ({
  page,
}) => {
  // Two of the styles are not OpenStreetMap. A picture exported over
  // imagery used to credit a service that had nothing to do with it, in the
  // corner of the picture and in the record beside it.
  await page.getByRole("button", { name: "Map Type", exact: true }).click();
  await page.getByRole("button", { name: /Aerial/ }).click();
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toHaveAttribute("data-map-style", "aerial");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const sidecar = page.waitForEvent("download", {
    predicate: (file) => file.suggestedFilename().endsWith(".json"),
  });
  await page.getByRole("button", { name: "Export picture" }).click();
  const file = await sidecar;
  const path = await file.path();
  const record = JSON.parse(
    await import("node:fs/promises").then((fs) => fs.readFile(path, "utf8")),
  ) as { basemap?: string };
  expect(record.basemap).toBe("USDA, USGS The National Map: Orthoimagery");
});

test("names every layer that was drawn in the record beside the picture", async ({
  page,
}) => {
  // The lib and the hook are both covered, and the line between them was not:
  // replacing the app's `overlayProvenance` with one that answers nothing left
  // the whole suite green, so the feature could be disconnected without a red
  // test. Weather Alerts is on by default and stubbed, so a still exported
  // here really does have a warning drawn over the radar.
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toHaveAttribute("data-layer-stack", /overlay-alerts-fill/);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const sidecar = page.waitForEvent("download", {
    predicate: (file) => file.suggestedFilename().endsWith(".json"),
  });
  await page.getByRole("button", { name: "Export picture" }).click();
  const file = await sidecar;
  const path = await file.path();
  const record = JSON.parse(
    await import("node:fs/promises").then((fs) => fs.readFile(path, "utf8")),
  ) as { layers?: Array<{ sourceId: string; attribution: string }> };

  const said = record.layers ?? [];
  expect(said.map((one) => one.sourceId)).toContain("alerts");
  expect(
    said.find((one) => one.sourceId === "alerts")?.attribution,
  ).toBeTruthy();
});

// The still test proves the caption is burned in; reading it back out of a
// WebM would mean decoding video, so this covers the recording itself.
test("writes the loop as a WebM the size cap allows", async ({ page }) => {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Export loop \(WebM\) \(3 frames\)/ }),
  ).toBeVisible();

  const download = page.waitForEvent("download", { timeout: 60_000 });
  // Named by container. There are two loop buttons now, and a bare
  // "Export loop" matches the MP4 one as well.
  await page.getByRole("button", { name: /Export loop \(WebM\)/ }).click();
  const file = await download;

  expect(file.suggestedFilename()).toMatch(/^openradar-loop-.*\.webm$/);
  const path = await file.path();
  const bytes = await import("node:fs/promises").then((fs) =>
    fs.readFile(path),
  );
  // The Matroska magic every WebM starts with, and well under the size cap.
  expect(bytes.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
  expect(bytes.byteLength).toBeLessThan(20 * 1024 * 1024);
  // Written by the app's own muxer rather than the browser's recorder, which
  // is the whole point: the recorder path plays the loop through in real time
  // and this one encodes each frame as it is drawn. Checked by who wrote the
  // file rather than by how long it took, because a clock reading is a
  // measurement of whatever else the machine was doing.
  expect(bytes.subarray(0, 200).toString("latin1")).toContain("OpenRadar");
  expect(bytes.subarray(0, 400).toString("latin1")).toMatch(/V_VP[89]/);
  // A recording with no frames in it is only headers. The test map is a flat
  // dark canvas, so three frames of it compress hard but still land well past
  // an empty container.
  expect(bytes.byteLength).toBeGreaterThan(2_500);
  await expect(page.getByText(/.webm saved/)).toBeVisible();
});

test("writes the loop as an MP4 a phone will play", async ({ page }) => {
  // The one people actually send each other, and the one nothing here had
  // ever written: the note beside this suite said Playwright's Chromium has
  // no H.264 encoder. It has one as of Chromium 151, so the path the export
  // panel offers can be walked rather than reasoned about.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const button = page.getByRole("button", { name: /Export loop \(MP4\)/ });
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();

  const download = page.waitForEvent("download", { timeout: 60_000 });
  await button.click();
  const file = await download;

  expect(file.suggestedFilename()).toMatch(/^openradar-loop-.*\.mp4$/);
  const path = await file.path();
  const bytes = await import("node:fs/promises").then((fs) =>
    fs.readFile(path),
  );
  // An ISO base media file names its brand in the first box.
  expect(bytes.subarray(4, 8).toString("latin1")).toBe("ftyp");
  expect(bytes.subarray(8, 12).toString("latin1")).toMatch(/isom|mp42|avc1/);
  // An H.264 track rather than an empty container. The sample description
  // sits in the index, which this muxer writes after the media data, so the
  // whole file is searched rather than its head: looking only at the first
  // few kilobytes would have failed on a file that is perfectly good.
  expect(bytes.toString("latin1")).toContain("avcC");
  expect(bytes.byteLength).toBeGreaterThan(2_500);
  expect(bytes.byteLength).toBeLessThan(20 * 1024 * 1024);
  await expect(page.getByText(/.mp4 saved/)).toBeVisible();
});

test("writes the loop as a GIF that a picture viewer opens", async ({
  page,
}) => {
  // The point of the GIF is that it goes where a WebM will not, so what is
  // checked is that the bytes are the format they claim to be: the signature,
  // the screen size, a global colour table, the Netscape block that makes it
  // loop, and the trailer.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("button", { name: /Export GIF/ })).toBeVisible();

  const download = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: /Export GIF/ }).click();
  const file = await download;

  expect(file.suggestedFilename()).toMatch(/^openradar-loop-.*\.gif$/);
  const path = await file.path();
  const bytes = await import("node:fs/promises").then((fs) =>
    fs.readFile(path),
  );

  expect(bytes.subarray(0, 6).toString("ascii")).toBe("GIF89a");
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  expect(width).toBeGreaterThan(0);
  expect(height).toBeGreaterThan(0);
  // A global colour table, which is what says the pixels can be read at all.
  expect(bytes[10] & 0x80).toBe(0x80);
  expect(bytes.toString("latin1")).toContain("NETSCAPE2.0");
  expect(bytes[bytes.length - 1]).toBe(0x3b);
  expect(bytes.byteLength).toBeLessThan(20 * 1024 * 1024);
  await expect(page.getByText(/.gif saved/)).toBeVisible();
});

test("gives the postcard heading to what it heads", async ({ page }) => {
  // `.settings-section` carries its spacing below itself, so two of them sit
  // apart by the lower one's padding, border and margin. This one comes
  // straight after four export buttons, which supply none of that, so the
  // heading sat 8 px under the last button and 26 px above its own paragraph
  // and read as a caption on the button rather than as the heading of what
  // follows. Measured rather than pinned to a number, because the gap that
  // matters is the one relative to the other side.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const heading = page.getByText("Send it to somebody");
  await expect(heading).toBeVisible();

  const gaps = await page.evaluate(() => {
    const title = [...document.querySelectorAll(".settings-section__title")]
      .filter((node) => node.closest("[data-postcard]"))
      .at(0);
    if (!title) return null;
    const section = title.closest("[data-postcard]")!;
    const above = section.previousElementSibling;
    const below = title.nextElementSibling;
    if (!above || !below) return null;
    const top = title.getBoundingClientRect().top;
    return {
      above: top - above.getBoundingClientRect().bottom,
      below:
        below.getBoundingClientRect().top -
        title.getBoundingClientRect().bottom,
    };
  });

  expect(gaps, "the postcard block is not laid out as expected").not.toBeNull();
  // A heading belongs to what is under it, so the space above must be at
  // least the space below.
  expect(
    gaps!.above,
    `the heading sits ${Math.round(gaps!.above)}px under the button and ${Math.round(
      gaps!.below,
    )}px above its own text`,
  ).toBeGreaterThanOrEqual(gaps!.below);
});
