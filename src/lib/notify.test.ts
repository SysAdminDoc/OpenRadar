import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * What the workspace can say about notifications without asking for them.
 *
 * The three answers are not decoration. A reader whose warning never arrived
 * is asking exactly this, and the two silences are different: Windows said no,
 * or nobody has asked it. The first read of this got it wrong in two ways,
 * both of which reported "nobody has asked" to somebody who had been refused.
 */
function withPermission(said: NotificationPermission | undefined) {
  const had = Object.getOwnPropertyDescriptor(globalThis, "Notification");
  if (said === undefined) {
    Reflect.deleteProperty(globalThis, "Notification");
  } else {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      writable: true,
      value: { permission: said },
    });
  }
  return () => {
    if (had) Object.defineProperty(globalThis, "Notification", had);
    else Reflect.deleteProperty(globalThis, "Notification");
  };
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@tauri-apps/plugin-notification");
});

/** A fresh module each time, because the remembered answer lives in it. */
async function freshNotify(granted: boolean) {
  vi.doMock("@tauri-apps/plugin-notification", () => ({
    isPermissionGranted: async () => granted,
    requestPermission: async () => (granted ? "granted" : "denied"),
    sendNotification: () => {},
  }));
  return await import("./notify");
}

describe("what the workspace can say about notifications", () => {
  it("reads a standing refusal on a cold start, before any watch has run", () => {
    // The case that matters most and that the first read got wrong: the
    // reader switched notifications off in Windows Settings last week. The
    // remembered answer is empty because nothing has been announced yet, and
    // reading only that called it "nobody has asked" while their warnings
    // were being dropped.
    const undo = withPermission("denied");
    return freshNotify(false)
      .then((notify) => notify.notificationPermission())
      .then((said) => expect(said).toBe("refused"))
      .finally(undo);
  });

  it("reads a standing grant the same way", () => {
    const undo = withPermission("granted");
    return freshNotify(false)
      .then((notify) => notify.notificationPermission())
      .then((said) => expect(said).toBe("granted"))
      .finally(undo);
  });

  it("says nobody has asked when nothing anywhere has an answer", () => {
    const undo = withPermission("default");
    return freshNotify(false)
      .then((notify) => notify.notificationPermission())
      .then((said) => expect(said).toBe("unasked"))
      .finally(undo);
  });

  it("calls a grant that has stopped being one a refusal, not a question", () => {
    // The second thing the first read got wrong. A watch fired and was
    // granted, the reader later turned notifications off, and the window
    // still calls the permission undecided. Answering "nobody has asked"
    // there is the same lie as the cold start.
    const undo = withPermission("default");
    return freshNotify(true)
      .then(async (notify) => {
        // A real announcement, which is what puts the grant on record.
        await notify.announceOnDesktop("A warning", "Somewhere", () => true);
        expect(await notify.notificationPermission()).toBe("granted");
        return notify;
      })
      .then(async (notify) => {
        vi.resetModules();
        vi.doMock("@tauri-apps/plugin-notification", () => ({
          isPermissionGranted: async () => false,
          requestPermission: async () => "denied",
          sendNotification: () => {},
        }));
        // The same module, whose remembered answer is still "granted", now
        // told by the native side that it is not.
        expect(await notify.notificationPermission()).toBe("refused");
      })
      .finally(undo);
  });

  it("takes the native side's word when the window has none", () => {
    const undo = withPermission(undefined);
    return freshNotify(true)
      .then((notify) => notify.notificationPermission())
      .then((said) => expect(said).toBe("granted"))
      .finally(undo);
  });

  it("records a refusal when a request comes back without a grant", async () => {
    const undo = withPermission("default");
    try {
      const notify = await freshNotify(false);
      expect(
        await notify.announceOnDesktop("A warning", "Somewhere", () => true),
      ).toBe(false);
      expect(await notify.notificationPermission()).toBe("refused");
    } finally {
      undo();
    }
  });
});

/**
 * A stand-in for the engine Windows provides, which remembers what it was
 * asked to say and hands back the utterance so a test can end it.
 */
function withSpeech(
  voices: number,
  options: { throws?: boolean; endsAtOnce?: boolean } = {},
) {
  let installed = voices;
  const said: Array<{ text: string; lang: string }> = [];
  const live: Array<{ onend?: () => void; onerror?: () => void }> = [];
  const listeners: Array<() => void> = [];
  let cancelled = 0;
  class Utterance {
    lang = "";
    onend?: () => void;
    onerror?: () => void;
    constructor(public text: string) {}
  }
  const engine = {
    getVoices: () => Array.from({ length: installed }, () => ({})),
    addEventListener: (_name: string, run: () => void) => listeners.push(run),
    cancel: () => {
      cancelled += 1;
      // What the engine actually does. `cancel` raises `error` on the
      // utterance it cuts, and a stub that only empties its own list hides
      // every consequence of that.
      for (const one of live.splice(0)) one.onerror?.();
    },
    speak: (one: Utterance) => {
      if (options.throws) throw new Error("the voice service is not running");
      said.push({ text: one.text, lang: one.lang });
      // An engine that finishes before `speak` returns, which Chromium does
      // not do and a stricter one might.
      if (options.endsAtOnce) {
        one.onend?.();
        return;
      }
      live.push(one);
    },
  };
  const had = {
    speech: Object.getOwnPropertyDescriptor(globalThis, "speechSynthesis"),
    utterance: Object.getOwnPropertyDescriptor(
      globalThis,
      "SpeechSynthesisUtterance",
    ),
  };
  Object.defineProperty(globalThis, "speechSynthesis", {
    configurable: true,
    writable: true,
    value: engine,
  });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
    configurable: true,
    writable: true,
    value: Utterance,
  });
  return {
    said,
    words: () => said.map((one) => one.text),
    cancelled: () => cancelled,
    /** Ends the sentence being read, the way the engine does. */
    finish: () => live.shift()?.onend?.(),
    /** The voice list arriving, which on Windows takes a moment. */
    voicesArrive: () => {
      installed = 2;
      listeners.splice(0).forEach((run) => run());
    },
    /** How many utterances the engine believes it is still reading. */
    live: () => live.length,
    /** How many callbacks are waiting on the voice list. */
    listeners: () => listeners.length,
    /** Stops throwing, for the sentence after the one that failed. */
    recover: () => {
      options.throws = false;
    },
    undo: () => {
      for (const [name, held] of [
        ["speechSynthesis", had.speech],
        ["SpeechSynthesisUtterance", had.utterance],
      ] as const) {
        if (held) Object.defineProperty(globalThis, name, held);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

/** A fresh module each time, because the queue lives in it. */
async function freshSpeech() {
  return await import("./notify");
}

describe("reading an alert aloud", () => {
  it("says one sentence at a time rather than over the last", async () => {
    // `speechSynthesis.speak` starts a second utterance over the first.
    // Three warnings landing in one poll would be three voices reading three
    // county names at once, which is worse than any one of them alone.
    const engine = withSpeech(2);
    try {
      const { speak } = await freshSpeech();
      speak("A tornado warning, two miles away");
      speak("A flood warning, at the school");
      expect(engine.words()).toEqual(["A tornado warning, two miles away"]);
      engine.finish();
      expect(engine.words()).toEqual([
        "A tornado warning, two miles away",
        "A flood warning, at the school",
      ]);
    } finally {
      engine.undo();
    }
  });

  it("keeps every warning of a batch, the ones in the middle included", async () => {
    // The first shape of this replaced a waiting sentence with a newer one
    // for the same place. Three warnings for one place in one poll meant the
    // first and the third were read and the middle one was silently lost,
    // and the feed order makes which one that is arbitrary: in the case that
    // found it, the tornado warning was the one nobody heard.
    const engine = withSpeech(2);
    try {
      const { speak } = await freshSpeech();
      speak("A flash flood warning, at home");
      speak("A tornado warning, at home");
      speak("A severe thunderstorm warning, at home");
      engine.finish();
      engine.finish();
      expect(engine.words()).toEqual([
        "A flash flood warning, at home",
        "A tornado warning, at home",
        "A severe thunderstorm warning, at home",
      ]);
    } finally {
      engine.undo();
    }
  });

  it("waits for the voice list, which fills after the page does", async () => {
    // Recorded against WebView2: `getVoices` is empty for a moment on a
    // cold start and speaking into that is silent.
    const engine = withSpeech(0);
    try {
      const { speak } = await freshSpeech();
      speak("A tornado warning");
      expect(engine.said).toHaveLength(0);
      engine.voicesArrive();
      expect(engine.said).toHaveLength(1);
    } finally {
      engine.undo();
    }
  });

  it("carries on after an engine that refuses", async () => {
    // This is called from the watch's own loop, between the tone and the
    // notification. A throw from here took the announcement, the record and
    // the rest of the batch with it, and left the alert unannounced so the
    // next poll threw in the same place: an addition that suppressed the
    // thing it was added to.
    const engine = withSpeech(2, { throws: true });
    try {
      const { speak } = await freshSpeech();
      expect(() => speak("A tornado warning")).not.toThrow();
      engine.recover();
      speak("A flood warning");
      expect(engine.words()).toEqual(["A flood warning"]);
    } finally {
      engine.undo();
    }
  });

  it("gives up on a sentence the engine never finishes", async () => {
    // `speechSynthesis` promises an `end` event and Chromium drops it on an
    // utterance it cut off. Without a ceiling the first sentence that goes
    // quiet stops every warning after it for the life of the run.
    vi.useFakeTimers();
    const engine = withSpeech(2);
    try {
      const { speak } = await freshSpeech();
      speak("A tornado warning");
      speak("A flood warning");
      expect(engine.words()).toEqual(["A tornado warning"]);
      // Nothing ends it. The second sentence waits, and then stops waiting.
      await vi.advanceTimersByTimeAsync(21_000);
      expect(engine.cancelled()).toBe(1);
      expect(engine.words()).toEqual(["A tornado warning", "A flood warning"]);
    } finally {
      engine.undo();
      vi.useRealTimers();
    }
  });

  it("does not read a warning out four minutes late", async () => {
    // Worse than not reading it at all: it is about a storm that has moved.
    // The case is a machine with no voices at all until one is installed:
    // the queue waits for `voiceschanged`, which may never come, and what it
    // is holding when it does is warnings from whenever the app started.
    vi.useFakeTimers();
    const engine = withSpeech(0);
    try {
      const { speak } = await freshSpeech();
      speak("A flood warning from four minutes ago");
      await vi.advanceTimersByTimeAsync(4 * 60_000);
      engine.voicesArrive();
      expect(engine.words()).toEqual([]);
      // And the queue is not stuck: something said now is said now.
      speak("A tornado warning, still in force");
      expect(engine.words()).toEqual(["A tornado warning, still in force"]);
    } finally {
      engine.undo();
      vi.useRealTimers();
    }
  });

  it("reads one sentence at a time through the ceiling as well", async () => {
    // The way this queue could still speak over itself, and only through the
    // line written to stop it. `cancel` raises `error` on the utterance it
    // cuts; that handler was the same closure the queue uses to move on, so
    // it cleared the hold on the sentence that had just started and the one
    // after that was spoken over it.
    vi.useFakeTimers();
    const engine = withSpeech(2);
    try {
      const { speak } = await freshSpeech();
      speak("A tornado warning");
      speak("A flash flood warning");
      speak("A severe thunderstorm warning");
      await vi.advanceTimersByTimeAsync(21_000);
      expect(engine.words()).toEqual([
        "A tornado warning",
        "A flash flood warning",
      ]);
      // One being read, not two.
      expect(engine.live()).toBe(1);
    } finally {
      engine.undo();
      vi.useRealTimers();
    }
  });

  it("is not held by a sentence that finished before speak returned", async () => {
    // Chromium raises `end` on its own thread, so this is a stricter engine
    // than the one that ships. It costs nothing to survive and the same
    // bookkeeping is what the cancelled utterance above corrupts: the queue
    // was marked as reading a sentence that had already ended, and every
    // warning after it waited the full twenty seconds.
    const engine = withSpeech(2, { endsAtOnce: true });
    try {
      const { speak } = await freshSpeech();
      speak("A tornado warning");
      speak("A flash flood warning");
      expect(engine.words()).toEqual([
        "A tornado warning",
        "A flash flood warning",
      ]);
    } finally {
      engine.undo();
    }
  });

  it("waits for the voice list with one listener, not one for each", async () => {
    // `once` deduplicates nothing when every call hands it a new function,
    // so a queue that filled before the list did would call back once per
    // sentence and each of those would try to start reading.
    const engine = withSpeech(0);
    try {
      const { speak } = await freshSpeech();
      speak("A tornado warning");
      speak("A flash flood warning");
      speak("A severe thunderstorm warning");
      expect(engine.listeners()).toBe(1);
      engine.voicesArrive();
      expect(engine.words()).toEqual(["A tornado warning"]);
      expect(engine.live()).toBe(1);
    } finally {
      engine.undo();
    }
  });

  it("says nothing at all where there is no engine", async () => {
    // A browser preview with the API switched off, and every test that has
    // not asked for one. The queue must not hold the sentence either, or a
    // later run would say a warning that is long over.
    const engine = withSpeech(2);
    engine.undo();
    const { speak } = await freshSpeech();
    expect(() => speak("A tornado warning")).not.toThrow();
    const again = withSpeech(2);
    try {
      speak("A flood warning");
      expect(again.words()).toEqual(["A flood warning"]);
    } finally {
      again.undo();
    }
  });

  it("carries the language the reader is reading in", async () => {
    const engine = withSpeech(2);
    try {
      const { setLanguage } = await import("../i18n");
      const { speak } = await freshSpeech();
      setLanguage("fr");
      speak("Une alerte");
      // `fr-CA` rather than `fr`: the app writes French for a reader in
      // Quebec, and a voice should read it that way too.
      expect(engine.said[0].lang).toBe("fr-CA");
      setLanguage("en");
    } finally {
      engine.undo();
    }
  });
});
