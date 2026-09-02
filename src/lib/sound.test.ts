import { afterEach, describe, expect, it, vi } from "vitest";
import {
  playAlertTone,
  resetSound,
  toneIsSafe,
  FORBIDDEN_HZ,
  FORBIDDEN_MARGIN_HZ,
  MAX_SECONDS,
  TONES,
  loadAlertSound,
  setAlertSound,
  soundNameAllowed,
  MAX_SOUND_BYTES,
} from "./sound";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SEVERITY_RANK } from "./overlays/alerts";
import { DEFAULT_SETTINGS } from "./settings";

/** A stand-in for the browser's audio, counting what was asked of it. */
function fakeAudio() {
  const started: number[] = [];
  const oscillator = {
    type: "",
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(() => ({ connect: vi.fn() })),
    start: vi.fn((at: number) => started.push(at)),
    stop: vi.fn(),
  };
  const context = {
    state: "running",
    currentTime: 0,
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    close: vi.fn(async () => {}),
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => ({
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(() => ({ connect: vi.fn() })),
    })),
    destination: {},
    decodeAudioData: vi.fn(async () => ({ duration: 0.4 })),
    createBufferSource: vi.fn(() => ({
      buffer: null,
      connect: vi.fn(() => ({ connect: vi.fn() })),
      start: vi.fn(),
    })),
  };
  return { context, oscillator, started };
}

afterEach(() => {
  resetSound();
  vi.unstubAllGlobals();
});

describe("the tone an alert makes", () => {
  it("is off until somebody asks for it", () => {
    // A weather app that makes a noise on its own is a weather app people
    // close, so nothing about the default settings should be able to.
    expect(DEFAULT_SETTINGS.watch.sound).toBe(false);
  });

  it("plays the pattern for the severity, and says that it did", async () => {
    const audio = fakeAudio();
    // A plain function, not an arrow: the code under test builds this with
    // new, and an arrow cannot be constructed.
    vi.stubGlobal("AudioContext", function () {
      return audio.context;
    });

    expect(await playAlertTone("moderate")).toBe(true);
    expect(audio.oscillator.start).toHaveBeenCalledTimes(
      TONES.moderate.notes.length,
    );
    // Faded rather than switched, because a square edge on a sine is a click.
    expect(audio.context.createGain).toHaveBeenCalled();

    // And a worse one is a different sound, which is the whole point of it
    // no longer being a single note for everything.
    const worse = fakeAudio();
    resetSound();
    vi.stubGlobal("AudioContext", function () {
      return worse.context;
    });
    expect(await playAlertTone("extreme")).toBe(true);
    expect(worse.oscillator.start).toHaveBeenCalledTimes(
      TONES.extreme.notes.length,
    );
    expect(TONES.extreme.notes.length).not.toBe(TONES.moderate.notes.length);
  });

  it("keeps one audio context however many times it plays", async () => {
    const audio = fakeAudio();
    const made = vi.fn(function () {
      return audio.context;
    });
    vi.stubGlobal("AudioContext", made);

    await playAlertTone("moderate");
    await playAlertTone("moderate");
    await playAlertTone("moderate");
    expect(made).toHaveBeenCalledTimes(1);
    expect(audio.oscillator.start).toHaveBeenCalledTimes(
      3 * TONES.moderate.notes.length,
    );
  });

  it("wakes a context the browser suspended", async () => {
    const audio = fakeAudio();
    audio.context.state = "suspended";
    vi.stubGlobal("AudioContext", function () {
      return audio.context;
    });

    expect(await playAlertTone()).toBe(true);
    expect(audio.context.resume).toHaveBeenCalled();
  });

  it("says nothing happened rather than throwing when it cannot play", async () => {
    // A browser refuses to make a sound before the reader has touched the
    // page, and a machine can have no audio at all. The notification still
    // arrives; this was only ever the quicker half of it.
    vi.stubGlobal("AudioContext", undefined);
    expect(await playAlertTone()).toBe(false);

    vi.stubGlobal("AudioContext", function () {
      throw new Error("no audio device");
    });
    expect(await playAlertTone()).toBe(false);

    const stuck = fakeAudio();
    stuck.context.state = "suspended";
    stuck.context.resume = vi.fn(async () => {});
    vi.stubGlobal("AudioContext", function () {
      return stuck.context;
    });
    expect(await playAlertTone()).toBe(false);
    expect(stuck.oscillator.start).not.toHaveBeenCalled();
  });
});

describe("what this app will not play", () => {
  it("keeps every tone clear of the signals it must not imitate", () => {
    for (const [severity, tone] of Object.entries(TONES)) {
      expect(toneIsSafe(tone), severity).toBe(true);
      for (const note of tone.notes) {
        for (const banned of FORBIDDEN_HZ) {
          expect(
            Math.abs(note - banned),
            `${severity} at ${note} Hz is too near ${banned} Hz`,
          ).toBeGreaterThan(FORBIDDEN_MARGIN_HZ);
        }
      }
    }
  });

  it("refuses a tone that has been edited into one of them", () => {
    // The check is the control. Without it the table is a promise nobody is
    // holding, and the whole point of writing this down is that a future
    // edit is where the risk is.
    expect(toneIsSafe({ notes: [853], each: 0.2 })).toBe(false);
    expect(toneIsSafe({ notes: [960], each: 0.2 })).toBe(false);
    expect(toneIsSafe({ notes: [1050], each: 0.2 })).toBe(false);
    expect(toneIsSafe({ notes: [523.25, 1049], each: 0.2 })).toBe(false);
  });

  it("keeps every sound far shorter than a real signal is", () => {
    // The attention signal runs eight to twenty-five seconds. Nothing here
    // gets anywhere near that, and the check refuses anything that tries.
    for (const [severity, tone] of Object.entries(TONES)) {
      expect(tone.notes.length * tone.each, severity).toBeLessThanOrEqual(
        MAX_SECONDS,
      );
    }
    expect(toneIsSafe({ notes: [523.25], each: MAX_SECONDS + 0.1 })).toBe(
      false,
    );
  });

  it("never sounds two notes at once", () => {
    // The attention signal is two tones together. These are sequences, and
    // the code that plays them starts each note after the last one ends, so
    // there is no arrangement of this table that produces a chord.
    const source = readFileSync(join(import.meta.dirname, "sound.ts"), "utf8");
    expect(source).toContain("start + at * tone.each");
    expect(source).not.toMatch(
      /setValueAtTime\([^)]*\)\s*;\s*.*createOscillator/,
    );
  });
});

describe("the kit", () => {
  it("has a sound for every severity, and they differ", () => {
    const shapes = new Set<string>();
    for (const severity of Object.keys(SEVERITY_RANK)) {
      const tone = TONES[severity as keyof typeof TONES];
      expect(tone, severity).toBeDefined();
      shapes.add(JSON.stringify(tone));
    }
    // A tornado warning and a special weather statement must not sound
    // identical, which is the whole reason this stopped being one note.
    expect(shapes.size).toBe(Object.keys(SEVERITY_RANK).length);
  });

  it("gets louder and longer as it gets worse", () => {
    // The only ordering somebody hears without being taught it.
    expect(TONES.extreme.notes.length).toBeGreaterThan(
      TONES.severe.notes.length,
    );
    expect(TONES.severe.notes.length).toBeGreaterThan(
      TONES.moderate.notes.length,
    );
  });
});

describe("a sound of the reader's own", () => {
  it("refuses one that is not audio by name", async () => {
    expect(soundNameAllowed("C:/sounds/alert.wav")).toBe(true);
    expect(soundNameAllowed("C:/sounds/alert.MP3")).toBe(true);
    // Refused before anything is opened, let alone decoded.
    expect(soundNameAllowed("C:/sounds/alert.exe")).toBe(false);
    expect(soundNameAllowed("C:/sounds/alert")).toBe(false);
    expect(await loadAlertSound("C:/sounds/alert.exe")).toEqual({
      ok: false,
      reason: "name",
    });
  });

  it("refuses one that is too big rather than half-playing it", async () => {
    const audio = fakeAudio();
    vi.stubGlobal("AudioContext", function () {
      return audio.context;
    });
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(MAX_SOUND_BYTES + 1),
    }));
    // Reported now, where the reader chose it, rather than as an
    // unexplained silence during a warning.
    expect(await loadAlertSound("C:/sounds/alert.wav")).toEqual({
      ok: false,
      reason: "size",
    });
  });

  it("refuses one the browser cannot decode", async () => {
    const audio = fakeAudio();
    audio.context.decodeAudioData = vi.fn(async () => {
      throw new Error("not audio");
    });
    vi.stubGlobal("AudioContext", function () {
      return audio.context;
    });
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(64),
    }));
    expect(await loadAlertSound("C:/sounds/alert.wav")).toEqual({
      ok: false,
      reason: "decode",
    });
  });

  it("falls back to the kit when the file was refused", async () => {
    const audio = fakeAudio();
    vi.stubGlobal("AudioContext", function () {
      return audio.context;
    });
    // Chosen, then found wanting. The warning still has to make a noise.
    setAlertSound("C:/sounds/gone.wav");
    expect(await playAlertTone("moderate")).toBe(true);
    expect(audio.oscillator.start).toHaveBeenCalledTimes(
      TONES.moderate.notes.length,
    );
  });

  it("is kept by path, so a backup cannot swallow it", () => {
    // The settings hold where it is rather than what is in it: a backup that
    // carried two megabytes of audio would quietly become the only copy.
    const source = readFileSync(
      join(import.meta.dirname, "settings.ts"),
      "utf8",
    );
    expect(source).toContain("alertSoundPath");
    expect(source).not.toContain("alertSoundBytes");
    expect(DEFAULT_SETTINGS.alertSoundPath).toBeNull();
  });
});
