import { APP_VERSION, isDesktopRuntime } from "./settings";
import { translate } from "../i18n";

export interface UpdateOffer {
  version: string;
  notes: string;
  date: string | null;
}

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; offer: UpdateOffer }
  | { status: "downloading"; percent: number }
  | { status: "ready" }
  | { status: "error"; message: string };

/** A browser preview has nothing to update, and no way to restart itself. */
export function updatesAvailable(): boolean {
  return isDesktopRuntime();
}

/**
 * The manifest is published beside the installer on the GitHub release, so a
 * check is one request to a static file and needs nothing running anywhere.
 */
export async function checkForUpdate(): Promise<UpdateOffer | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const found = await check();
  if (!found) return null;
  // The plugin decides what is newer from the manifest. A manifest that names
  // this build or an older one is not an update, whatever it claims, and
  // offering it would install the version already running.
  if (!isNewer(found.version)) return null;
  return {
    version: found.version,
    notes: found.body ?? "",
    date: found.date ?? null,
  };
}

/**
 * Downloads and installs, then restarts into the new build. The percentage is
 * reported as it arrives so a slow connection does not look like a hang.
 */
export async function installUpdate(
  onProgress: (percent: number) => void,
): Promise<void> {
  const [{ check }, { relaunch }] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process"),
  ]);
  const found = await check();
  if (!found) throw new Error(translate("update.notOffered"));

  let total = 0;
  let taken = 0;
  await found.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      onProgress(0);
    } else if (event.event === "Progress") {
      taken += event.data.chunkLength;
      onProgress(total ? Math.min(100, Math.round((taken / total) * 100)) : 0);
    } else if (event.event === "Finished") {
      onProgress(100);
    }
  });
  await relaunch();
}

/** Newer, older, or the same, comparing the numbers rather than the strings. */
export function compareVersions(left: string, right: string): number {
  const parts = (value: string) =>
    value
      .replace(/^v/, "")
      .split(/[.\-+]/)
      .map((piece) => (/^\d+$/.test(piece) ? Number(piece) : piece));
  const a = parts(left);
  const b = parts(right);
  for (let at = 0; at < Math.max(a.length, b.length); at += 1) {
    const one = a[at] ?? 0;
    const two = b[at] ?? 0;
    if (one === two) continue;
    if (typeof one === "number" && typeof two === "number") {
      return one > two ? 1 : -1;
    }
    // A release beats a prerelease of the same numbers.
    if (typeof one === "number") return 1;
    if (typeof two === "number") return -1;
    return one > two ? 1 : -1;
  }
  return 0;
}

export function isNewer(offered: string): boolean {
  return compareVersions(offered, APP_VERSION) > 0;
}
