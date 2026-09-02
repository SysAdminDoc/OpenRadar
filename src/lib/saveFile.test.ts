import { afterEach, describe, expect, it, vi } from "vitest";
import { saveFile } from "./saveFile";

/**
 * How an exported file crosses to the native side.
 *
 * It used to go as a JavaScript number array, which is JSON: three and a half
 * bytes of string per byte of file, built on the thread drawing the map while
 * the reader waited. A sixteen megabyte loop measured 411 ms to convert and
 * 141 ms to serialise on this machine and produced a 57 MB string, and the
 * ceiling on an export is sixty-four megabytes.
 *
 * Nothing else can see this. The end-to-end suite runs in a browser with no
 * Tauri, so it takes the download path below and never meets the invoke.
 */
const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

function insideTheApp() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

afterEach(() => {
  invoke.mockReset();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("saving an export", () => {
  it("hands over the bytes themselves, not a list of numbers", async () => {
    insideTheApp();
    invoke.mockResolvedValue("C:/Users/somebody/Pictures/loop.webm");

    const answer = await saveFile(
      "loop.webm",
      new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]),
    );

    expect(answer.path).toBe("C:/Users/somebody/Pictures/loop.webm");
    const [command, payload, options] = invoke.mock.calls[0];
    expect(command).toBe("save_export");
    expect(payload).toBeInstanceOf(Uint8Array);
    expect([...(payload as Uint8Array)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    // The name travels in a header, because a raw body carries nothing else.
    expect((options as { headers: Record<string, string> }).headers).toEqual({
      "x-file-name": "loop.webm",
    });
  });

  it("downloads it in a browser preview, where there is no native side", async () => {
    const clicked: string[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.download);
      });
    // jsdom has neither of these.
    const url = window.URL as unknown as Record<string, unknown>;
    url.createObjectURL = vi.fn(() => "blob:openradar");
    url.revokeObjectURL = vi.fn();

    const answer = await saveFile("loop.webm", new Blob([new Uint8Array([1])]));
    expect(answer.path).toBeNull();
    expect(clicked).toEqual(["loop.webm"]);
    expect(invoke).not.toHaveBeenCalled();
    click.mockRestore();
  });
});
