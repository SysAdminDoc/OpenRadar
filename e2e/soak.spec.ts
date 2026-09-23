import { expect, type CDPSession } from "@playwright/test";
import { appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { routeWorkspace, test } from "./support/fixtures";

/**
 * Whether the workspace holds its memory over a long session.
 *
 * The product is meant to be left open on a second monitor for days, and no
 * other spec runs longer than a minute. This opens the workspace with the
 * radar hosts stood in for, leaves the loop playing, opens and closes panels
 * the way a reader glances at them, and every so often collects garbage and
 * writes down what is still held: the JavaScript heap and the array buffers
 * beside it, the page's own Blink objects, the DOM nodes, the listeners, the
 * documents. What a leak looks
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

/**
 * A radar tile the size a real one is, with something in it.
 *
 * The suite's stand-in for every picture is one transparent pixel, which
 * decodes to four bytes, so a tile or a frame the map never let go of cost
 * nothing a soak could see. A real tile is 256 pixels square and a quarter
 * of a megabyte once decoded, which is the cost a leak of them has.
 */
function radarTile(): Buffer {
  const side = 256;
  const stride = side * 4 + 1;
  const raw = Buffer.alloc(stride * side);
  for (let y = 0; y < side; y += 1) {
    // Each row starts with its filter byte, left at none.
    for (let x = 0; x < side; x += 1) {
      const at = y * stride + 1 + x * 4;
      const level = (x * 7 + y * 13) % 256;
      raw[at] = level;
      raw[at + 1] = 255 - level;
      raw[at + 2] = (x ^ y) & 255;
      raw[at + 3] = 180;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // red, green, blue and alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** What a flat line is allowed to wander by, once warmed up. */
const HEAP_ALLOWANCE_MB = 32;
const NODE_ALLOWANCE = 2_000;
/** The page's own Blink objects come to about two megabytes. */
const BLINK_ALLOWANCE_MB = 8;

/**
 * What the page's own Blink objects hold, and apart from them what DevTools
 * is keeping about the page's requests, read out of a heap snapshot.
 *
 * `embedderHeapUsedSize` is the number a leak on the Blink side would move,
 * and under Playwright it cannot be read as one. Playwright listens to the
 * network, so the browser keeps a record of every request the page makes
 * (`blink::NetworkResourcesData`), and the loop against stood-in hosts makes
 * about forty a second. Measured on 2026-09-23 over six minutes: the
 * embedder heap rose 5.5 MB, the records 3.9 MB of it, and every other Blink
 * object in the page 0.3 MB, most of that transitions still running from the
 * panels just closed. The packaged app runs with no DevTools attached, so the
 * records do not exist there. The snapshot names every object, which is what
 * lets the two be told apart; the V8 internals it also lists as native are
 * the heap figure's business, not this one's.
 */
async function blinkHeld(
  devtools: CDPSession,
): Promise<{ pageMb: number; devtoolsMb: number }> {
  const chunks: string[] = [];
  const onChunk = (event: { chunk: string }) => chunks.push(event.chunk);
  devtools.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  await devtools.send("HeapProfiler.takeHeapSnapshot", {
    reportProgress: false,
  });
  devtools.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
  const snapshot = JSON.parse(chunks.join("")) as {
    snapshot: {
      meta: { node_fields: string[]; node_types: [string[], ...unknown[]] };
    };
    nodes: number[];
    strings: string[];
  };
  const fields = snapshot.snapshot.meta.node_fields;
  const width = fields.length;
  const typeAt = fields.indexOf("type");
  const nameAt = fields.indexOf("name");
  const sizeAt = fields.indexOf("self_size");
  const types = snapshot.snapshot.meta.node_types[typeAt] as string[];
  let page = 0;
  let records = 0;
  for (let at = 0; at < snapshot.nodes.length; at += width) {
    if (types[snapshot.nodes[at + typeAt]] !== "native") continue;
    const name = snapshot.strings[snapshot.nodes[at + nameAt]];
    const size = snapshot.nodes[at + sizeAt];
    if (name.startsWith("blink::NetworkResourcesData")) records += size;
    else if (!name.startsWith("system / ")) page += size;
  }
  return { pageMb: page / 1024 / 1024, devtoolsMb: records / 1024 / 1024 };
}

/** The panels a reader glances at between looks at the map. */
const GLANCES = ["Layers", "Alerts", "Forecast", "Settings"];

test("the workspace holds its memory over a long session", async ({ page }) => {
  test.setTimeout((HOURS * 60 + 20) * 60_000);
  await routeWorkspace(page);
  // The loop's own tiles at the size real ones are, over the suite's
  // one-pixel stand-in. Registered after the workspace's routes, so it is
  // asked first, and counted, so a run that never reached it cannot pass
  // for one that did.
  const tile = radarTile();
  let tilesServed = 0;
  await page.route("https://opengeo.ncep.noaa.gov/**", async (route) => {
    if (route.request().url().includes("GetCapabilities")) {
      await route.fallback();
      return;
    }
    tilesServed += 1;
    await route.fulfill({ contentType: "image/png", body: tile });
  });
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();

  const devtools = await page.context().newCDPSession(page);
  await devtools.send("Performance.enable");
  await devtools.send("HeapProfiler.enable");

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
    const blink = await blinkHeld(devtools);
    return {
      minute,
      heapMb: megabytes(metric("JSHeapUsedSize")),
      buffersMb: megabytes(usage.backingStorageSize),
      embedderMb: megabytes(usage.embedderHeapUsedSize),
      blinkMb: blink.pageMb,
      devtoolsMb: blink.devtoolsMb,
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
    "minute,heap_mb,buffers_mb,embedder_mb,page_blink_mb,devtools_records_mb,nodes,listeners,documents\n",
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
      `${sample.minute},${sample.heapMb.toFixed(2)},${sample.buffersMb.toFixed(2)},${sample.embedderMb.toFixed(2)},${sample.blinkMb.toFixed(2)},${sample.devtoolsMb.toFixed(2)},${sample.nodes},${sample.listeners},${sample.documents}\n`,
    );
    console.log(
      `soak ${minute} min: heap ${sample.heapMb.toFixed(1)} MB, buffers ${sample.buffersMb.toFixed(1)} MB, page Blink ${sample.blinkMb.toFixed(1)} MB, ${sample.nodes} nodes, ${sample.listeners} listeners`,
    );
  }

  // Measured from the first hour rather than from the start: the tiles, the
  // frames and the panels' own caches all fill during it, and a rise while
  // they do is the cache working, not a leak. A run of an hour or less
  // settles at its halfway point instead, or it would hold its last sample
  // against itself and pass whatever happened.
  const settleAt = Math.min(60, (HOURS * 60) / 2);
  const settled =
    samples.find((sample) => sample.minute >= settleAt) ?? samples[0];
  const last = samples.at(-1)!;
  expect(
    last.minute,
    "the soak ended before there was anything to measure",
  ).toBeGreaterThan(settled.minute);
  console.log(`soak served ${tilesServed} radar tiles at full size`);
  expect(tilesServed, "the loop never asked for a radar tile").toBeGreaterThan(
    0,
  );
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
  expect(
    last.blinkMb - settled.blinkMb,
    `the page's own Blink objects climbed from ${settled.blinkMb.toFixed(1)} MB at an hour to ${last.blinkMb.toFixed(1)} MB; the trace is ${TRACE}`,
  ).toBeLessThan(BLINK_ALLOWANCE_MB);
});
