import { translate } from "../i18n";
import { log } from "./log";
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
        // The worker's own line goes to the log and the reader gets this
        // app's sentence. What comes back over that channel is the encoder's
        // message, in English whatever the workspace is set to, and it used
        // to be built into a plain `Error`: `failureSentence` passes a plain
        // `Error`'s message through by design, so it landed in the toast.
        log.warn("export", event.data.error ?? "the GIF worker sent no reason");
        reject(new Error(translate("export.gifFailed")));
        return;
      }
      resolve(new Blob([event.data.bytes], { type: "image/gif" }));
    };
    worker.onerror = (event) => {
      worker.terminate();
      log.warn("export", event.message || "the GIF worker would not start");
      reject(new Error(translate("export.gifFailed")));
    };
    worker.postMessage({ pictures: buffers, width, height, delayMs }, buffers);
  });
}
