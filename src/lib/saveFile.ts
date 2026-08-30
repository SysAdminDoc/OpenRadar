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
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const path = await invoke<string>("save_export", { fileName, bytes });
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
