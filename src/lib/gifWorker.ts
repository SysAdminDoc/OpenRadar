import { encodeGifPictures } from "./gif";

interface GifWorkerReply {
  ok: boolean;
  bytes?: ArrayBuffer;
  error?: string;
}

/** Moves palette reduction and GIF compression off the interface thread. */
export function encodeGifOffThread(
  pictures: readonly Uint8ClampedArray[],
  width: number,
  height: number,
  delayMs: number,
): Promise<Blob> {
  if (typeof Worker === "undefined") {
    return Promise.resolve(encodeGifPictures(pictures, width, height, delayMs));
  }

  const worker = new Worker(
    new URL("../workers/gif.worker.ts", import.meta.url),
    {
      type: "module",
      name: "openradar-gif",
    },
  );
  const buffers = pictures.map((picture) => {
    if (
      picture.byteOffset === 0 &&
      picture.byteLength === picture.buffer.byteLength
    ) {
      return picture.buffer as ArrayBuffer;
    }
    return picture.slice().buffer;
  });

  return new Promise<Blob>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<GifWorkerReply>) => {
      worker.terminate();
      if (!event.data.ok || !event.data.bytes) {
        reject(new Error(event.data.error ?? "The GIF worker failed."));
        return;
      }
      resolve(new Blob([event.data.bytes], { type: "image/gif" }));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "The GIF worker failed."));
    };
    worker.postMessage({ pictures: buffers, width, height, delayMs }, buffers);
  });
}
