import { encodeGifPictures } from "../lib/gif";

interface GifWorkerRequest {
  pictures: ArrayBuffer[];
  width: number;
  height: number;
  delayMs: number;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<GifWorkerRequest>) => void) | null;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};

scope.onmessage = (event) => {
  void (async () => {
    try {
      const pictures = event.data.pictures.map(
        (buffer) => new Uint8ClampedArray(buffer),
      );
      const blob = encodeGifPictures(
        pictures,
        event.data.width,
        event.data.height,
        event.data.delayMs,
      );
      const bytes = await blob.arrayBuffer();
      scope.postMessage({ ok: true, bytes }, [bytes]);
    } catch (failure) {
      scope.postMessage(
        {
          ok: false,
          error:
            failure instanceof Error
              ? failure.message
              : "The GIF worker failed.",
        },
        [],
      );
    }
  })();
};
