import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeGifOffThread } from "./gifWorker";

const originalWorker = globalThis.Worker;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalWorker) vi.stubGlobal("Worker", originalWorker);
});

describe("GIF worker handoff", () => {
  it("transfers frame buffers and resolves the worker's GIF bytes", async () => {
    let sent: unknown;
    let transferred: Transferable[] = [];
    let terminated = false;
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      postMessage(message: unknown, transfer: Transferable[]) {
        sent = message;
        transferred = transfer;
        const bytes = new Uint8Array([71, 73, 70, 56, 57, 97]).buffer;
        queueMicrotask(() =>
          this.onmessage?.({ data: { ok: true, bytes } } as MessageEvent),
        );
      }

      terminate() {
        terminated = true;
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const frames = [
      new Uint8ClampedArray([1, 2, 3, 255]),
      new Uint8ClampedArray([4, 5, 6, 255]),
    ];

    const blob = await encodeGifOffThread(frames, 1, 1, 400);
    expect(transferred).toHaveLength(2);
    expect(sent).toMatchObject({ width: 1, height: 1, delayMs: 400 });
    expect(blob.type).toBe("image/gif");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([71, 73, 70, 56, 57, 97]),
    );
    expect(terminated).toBe(true);
  });
});
