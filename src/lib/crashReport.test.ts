import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The promise the crash lines in the report are making.
 *
 * A minidump holds the contents of memory at the moment a process died: the
 * volume it was decoding, the places a reader watches, whatever was on the
 * heap. The app says the file exists and where it is, and stops. That is a
 * promise, and a promise nothing checks is a comment.
 *
 * Read off the source rather than exercised, because what is being asserted
 * is the absence of a code path. A test that called every export and watched
 * for a request would pass while a request sat behind a branch it did not
 * take.
 */
const SOURCE = readFileSync(
  join(import.meta.dirname, "crashReport.ts"),
  "utf8",
);

describe("what the app does with a crash report", () => {
  it("has no way to send one anywhere", () => {
    // Every route out of the page, including the ones that are not `fetch`.
    for (const outbound of [
      "fetch(",
      "XMLHttpRequest",
      "sendBeacon",
      "WebSocket",
      "EventSource",
      "new Image",
      "http://",
      "https://",
    ]) {
      expect(SOURCE, `${outbound} in crashReport.ts`).not.toContain(outbound);
    }
  });

  it("reads and never writes", () => {
    // The commands it may invoke, named one by one. A command added here
    // that does anything but read fails this, which is the point: these
    // three lookups are the whole of what this module is allowed to do.
    const invoked = [
      ...SOURCE.matchAll(/invoke<[^>]*>\("([a-z_0-9]+)"\)/g),
    ].map((match) => match[1]);
    expect(invoked).toEqual([
      "crash_last_dump",
      "crash_last_webview_report",
      "host_webview_version",
    ]);
  });
});
