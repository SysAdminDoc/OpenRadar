import { afterEach, describe, expect, it, vi } from "vitest";
import { playAlertTone, resetSound } from "./sound";
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

  it("plays one note and says that it did", async () => {
    const audio = fakeAudio();
    // A plain function, not an arrow: the code under test builds this with
    // new, and an arrow cannot be constructed.
    vi.stubGlobal("AudioContext", function () {
      return audio.context;
    });

    expect(await playAlertTone()).toBe(true);
    expect(audio.oscillator.start).toHaveBeenCalledTimes(1);
    expect(audio.oscillator.stop).toHaveBeenCalledTimes(1);
    // Faded rather than switched, because a square edge on a sine is a click.
    expect(audio.context.createGain).toHaveBeenCalled();
  });

  it("keeps one audio context however many times it plays", async () => {
    const audio = fakeAudio();
    const made = vi.fn(function () {
      return audio.context;
    });
    vi.stubGlobal("AudioContext", made);

    await playAlertTone();
    await playAlertTone();
    await playAlertTone();
    expect(made).toHaveBeenCalledTimes(1);
    expect(audio.oscillator.start).toHaveBeenCalledTimes(3);
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
