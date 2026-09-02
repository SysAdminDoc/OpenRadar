import { invoke } from "@tauri-apps/api/core";
import { isDesktopRuntime } from "./settings";

export interface SavedFile {
  /** Where it landed, when the desktop app could say. */
  path: string | null;
}

/**
 * Writes an exported file where the person can find it. The desktop build hands
 * the bytes to Rust, which picks the folder and sanitizes the name; a browser
 * preview falls back to an ordinary download.
 */
export async function saveFile(
  fileName: string,
  blob: Blob,
): Promise<SavedFile> {
  if (isDesktopRuntime()) {
    // The bytes go over as a raw body. Spelling them as a JSON array of
    // numbers cost three and a half bytes of string per byte of file, built
    // on this thread while the reader waited: a sixteen megabyte loop
    // measured 411 ms to convert and 141 ms to serialise, and the ceiling is
    // sixty-four.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const path = await invoke<string>("save_export", bytes, {
      headers: { "x-file-name": fileName },
    });
    return { path };
  }

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // Give the download a tick to start before the handle goes away.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return { path: null };
}
