import { expect } from "@playwright/test";
import { appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { routeWorkspace, test } from "./support/fixtures";

/**
 * Whether the workspace holds its memory over a long session.
 *
 * The product is meant to be left open on a second monitor for days, and no
 * other spec runs longer than a minute. This opens the workspace with the
 * radar hosts stood in for, leaves the loop playing, opens and closes panels
 * the way a reader glances at them, and every so often collects garbage and
 * writes down what is still held: the JavaScript heap and the array buffers
 * beside it, the DOM nodes, the listeners, the documents. What a leak looks
 * like is a line that keeps climbing after the first hour, when every cache
 * has had time to fill. Memory on the graphics card is not in any of these,
 * and neither is the Rust process of the packaged app.
 *
 * Only through its own config, never the suite's: it runs for hours, against
 * a production build served on a port of its own so that editing the tree
 * while it runs cannot reload the page under it.
 *
 *     npm run soak
 *
 * `OPENRADAR_SOAK_HOURS` (default 8) and `OPENRADAR_SOAK_EVERY_MINUTES`
 * (default 10) set the length and the gap; the trace is written as CSV to
 * `OPENRADAR_SOAK_TRACE`, or the system's temporary directory.
 */
const HOURS = Number(process.env.OPENRADAR_SOAK_HOURS ?? 8);
const EVERY_MINUTES = Number(process.env.OPENRADAR_SOAK_EVERY_MINUTES ?? 10);
const TRACE =
  process.env.OPENRADAR_SOAK_TRACE ?? join(tmpdir(), "openradar-soak.csv");

/** What a flat line is allowed to wander by, once warmed up. */
const HEAP_ALLOWANCE_MB = 32;
const NODE_ALLOWANCE = 2_000;

/** The panels a reader glances at between looks at the map. */
const GLANCES = ["Layers", "Alerts", "Forecast", "Settings"];

test("the workspace holds its memory over a long session", async ({ page }) => {
  test.setTimeout((HOURS * 60 + 20) * 60_000);
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();

  const devtools = await page.context().newCDPSession(page);
  await devtools.send("Performance.enable");

  const read = async (minute: number) => {
    // After a collection, so what is measured is what is kept rather than
    // what happens to be waiting to be swept.
    await devtools.send("HeapProfiler.collectGarbage");
    const { metrics } = await devtools.send("Performance.getMetrics");
    const metric = (name: string) =>
      metrics.find((found) => found.name === name)?.value ?? Number.NaN;
    // The JavaScript heap does not count what an ArrayBuffer holds, and the
    // tiles and frames a radar map keeps are mostly that. Asked for apart.
    const usage = (await devtools.send("Runtime.getHeapUsage")) as {
      backingStorageSize?: number;
      embedderHeapUsedSize?: number;
    };
    const megabytes = (bytes: number | undefined) =>
      bytes === undefined ? Number.NaN : bytes / 1024 / 1024;
    return {
      minute,
      heapMb: megabytes(metric("JSHeapUsedSize")),
      buffersMb: megabytes(usage.backingStorageSize),
      embedderMb: megabytes(usage.embedderHeapUsedSize),
      nodes: metric("Nodes"),
      listeners: metric("JSEventListeners"),
      documents: metric("Documents"),
    };
  };

  const glance = async () => {
    for (const name of GLANCES) {
      await page.getByRole("button", { name, exact: true }).click();
      await page.keyboard.press("Escape");
    }
  };

  writeFileSync(
    TRACE,
    "minute,heap_mb,buffers_mb,embedder_mb,nodes,listeners,documents\n",
  );
  const samples: Awaited<ReturnType<typeof read>>[] = [];
  for (let minute = 0; minute <= HOURS * 60; minute += EVERY_MINUTES) {
    if (minute > 0) {
      await page.waitForTimeout(EVERY_MINUTES * 60_000 - 5_000);
      await glance();
    }
    const sample = await read(minute);
    samples.push(sample);
    appendFileSync(
      TRACE,
      `${sample.minute},${sample.heapMb.toFixed(2)},${sample.buffersMb.toFixed(2)},${sample.embedderMb.toFixed(2)},${sample.nodes},${sample.listeners},${sample.documents}\n`,
    );
    console.log(
      `soak ${minute} min: heap ${sample.heapMb.toFixed(1)} MB, buffers ${sample.buffersMb.toFixed(1)} MB, ${sample.nodes} nodes, ${sample.listeners} listeners`,
    );
  }

  // Measured from the first hour rather than from the start: the tiles, the
  // frames and the panels' own caches all fill during it, and a rise while
  // they do is the cache working, not a leak.
  const settled = samples.find((sample) => sample.minute >= 60) ?? samples[0];
  const last = samples.at(-1)!;
  expect(
    last.heapMb - settled.heapMb,
    `the heap climbed from ${settled.heapMb.toFixed(1)} MB at an hour to ${last.heapMb.toFixed(1)} MB; the trace is ${TRACE}`,
  ).toBeLessThan(HEAP_ALLOWANCE_MB);
  // Unasked for where the engine does not report it, rather than failing on
  // a number that was never measured.
  if (Number.isFinite(last.buffersMb) && Number.isFinite(settled.buffersMb)) {
    expect(
      last.buffersMb - settled.buffersMb,
      `array buffers climbed from ${settled.buffersMb.toFixed(1)} MB at an hour to ${last.buffersMb.toFixed(1)} MB; the trace is ${TRACE}`,
    ).toBeLessThan(HEAP_ALLOWANCE_MB);
  }
  expect(
    last.nodes - settled.nodes,
    `the page kept ${last.nodes - settled.nodes} more DOM nodes; the trace is ${TRACE}`,
  ).toBeLessThan(NODE_ALLOWANCE);
});
