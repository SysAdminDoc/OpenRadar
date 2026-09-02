import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  keepSoundPath,
  loadAlertSound,
  resetSound,
  MAX_SOUND_BYTES,
  SOUND_EXTENSIONS,
} from "./sound";

/**
 * How a sound of the reader's own gets in on the desktop.
 *
 * The shipped app could not do this at all. It converted the chosen path to
 * an `asset:` address and fetched it, against a protocol this binary is not
 * compiled with, so the fetch always threw and every reader who picked a file
 * was told it could not be read as audio. Nothing in the suite noticed,
 * because every test stubbed `fetch` and the browser suite never opens the
 * picker.
 *
 * So these hold the two things that were wrong: the bytes come over the
 * native command, and the reason the native side gives is the one the reader
 * is shown.
 */
const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

function audioIsAvailable() {
  const context = {
    state: "running",
    currentTime: 0,
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    destination: {},
    // A real decoder is handed an ArrayBuffer and nothing else. A fake that
    // accepts anything cannot tell whether the bridge handed back bytes.
    decodeAudioData: vi.fn(async (bytes: unknown) => {
      if (!(bytes instanceof ArrayBuffer)) {
        throw new TypeError("decodeAudioData was not given an ArrayBuffer");
      }
      return { duration: 0.4 };
    }),
  };
  vi.stubGlobal("AudioContext", function () {
    return context;
  });
  return context;
}

/** What `isDesktopRuntime` looks for. */
function insideTheApp() {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

afterEach(() => {
  resetSound();
  invoke.mockReset();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("reading the reader's own alert sound in the packaged app", () => {
  it("asks the native side for the bytes, and never the network", async () => {
    const context = audioIsAvailable();
    insideTheApp();
    // A fetch here is the bug this file exists for: nothing the page can
    // fetch reaches a file on disk in a packaged build.
    vi.stubGlobal("fetch", async () => {
      throw new Error("the page tried to fetch a file off the disk");
    });
    invoke.mockResolvedValue(new ArrayBuffer(64));

    expect(await loadAlertSound("C:/sounds/alert.wav")).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("alert_sound_bytes", {
      path: "C:/sounds/alert.wav",
    });
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it("takes the bytes in whichever shape the bridge hands them over", async () => {
    // Tauri returns a raw body as an ArrayBuffer over its custom protocol
    // and as a list of numbers over the postMessage fallback. Assuming the
    // first meant `byteLength` was undefined, the size ceiling below was
    // skipped without anyone noticing, and the decoder then threw and blamed
    // the reader's file, which is the message this whole change exists to
    // stop showing.
    const context = audioIsAvailable();
    insideTheApp();
    invoke.mockResolvedValue([82, 73, 70, 70]);
    expect(await loadAlertSound("C:/sounds/alert.wav")).toEqual({ ok: true });
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it("still refuses a list of numbers over the ceiling", async () => {
    audioIsAvailable();
    insideTheApp();
    invoke.mockResolvedValue(new Array(MAX_SOUND_BYTES + 1).fill(0));
    expect(await loadAlertSound("C:/sounds/big.wav")).toEqual({
      ok: false,
      reason: "size",
    });
  });

  it("refuses an answer that is not bytes at all", async () => {
    audioIsAvailable();
    insideTheApp();
    invoke.mockResolvedValue({ unexpected: true });
    expect(await loadAlertSound("C:/sounds/alert.wav")).toEqual({
      ok: false,
      reason: "decode",
    });
  });

  it("shows the sentence the native side asked for", async () => {
    audioIsAvailable();
    insideTheApp();
    invoke.mockRejectedValue({
      reason: "size",
      message: "the file is larger than the 2097152 byte limit",
    });

    expect(await loadAlertSound("C:/sounds/huge.wav")).toEqual({
      ok: false,
      reason: "size",
    });
  });

  it("falls back to the general answer when the failure says nothing", async () => {
    audioIsAvailable();
    insideTheApp();
    invoke.mockRejectedValue(new Error("the command is not registered"));

    expect(await loadAlertSound("C:/sounds/gone.wav")).toEqual({
      ok: false,
      reason: "decode",
    });
  });

  it("still refuses bytes over the ceiling the native side let through", async () => {
    audioIsAvailable();
    insideTheApp();
    invoke.mockResolvedValue(new ArrayBuffer(MAX_SOUND_BYTES + 1));

    expect(await loadAlertSound("C:/sounds/big.wav")).toEqual({
      ok: false,
      reason: "size",
    });
  });

  it("uses the address in a browser preview, where there is no native side", async () => {
    audioIsAvailable();
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(32),
    }));

    expect(await loadAlertSound("http://localhost/alert.wav")).toEqual({
      ok: true,
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("what happens to a stored path that will not load", () => {
  it("stops naming a file that is not playing", () => {
    // The same misleading toast fired on every launch, and the panel went on
    // showing the file as the sound in force, until the reader found the
    // button that clears it.
    for (const reason of ["name", "size", "decode"] as const) {
      expect(keepSoundPath(reason), reason).toBe(false);
    }
  });

  it("keeps the choice when the machine is the problem", () => {
    // Nothing is wrong with the file. It will play on the next machine.
    expect(keepSoundPath("noAudio")).toBe(true);
  });
});

describe("the two sides agree on what may be opened", () => {
  const rust = readFileSync(
    join(process.cwd(), "src-tauri", "src", "sound.rs"),
    "utf8",
  );

  it("stops at the same number of bytes", () => {
    // Two ceilings that drift apart give the reader a file the page accepts
    // and the disk refuses, or the reverse, and the message would be about
    // the wrong one.
    const written = /const MAX_BYTES: u64 = ([^;]+);/.exec(rust)?.[1];
    expect(written, "sound.rs no longer declares a ceiling").toBeDefined();
    const bytes = written!
      .split("*")
      .reduce(
        (total, part) => total * Number(part.trim().replace(/_/g, "")),
        1,
      );
    expect(bytes).toBe(MAX_SOUND_BYTES);
  });

  it("opens exactly what the picker offers", () => {
    const listed = /const ALLOWED_EXTENSIONS: &\[&str\] = &\[([^\]]+)\]/.exec(
      rust,
    )?.[1];
    expect(listed, "sound.rs no longer lists its extensions").toBeDefined();
    const names = [...listed!.matchAll(/"([a-z0-9]+)"/g)].map((one) => one[1]);
    expect(names.sort()).toEqual([...SOUND_EXTENSIONS].sort());
  });
});
