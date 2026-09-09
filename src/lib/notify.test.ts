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
function withSpeech(voices: number) {
  let installed = voices;
  const said: Array<{ text: string; lang: string }> = [];
  const live: Array<{ onend?: () => void; onerror?: () => void }> = [];
  const listeners: Array<() => void> = [];
  class Utterance {
    lang = "";
    onend?: () => void;
    onerror?: () => void;
    constructor(public text: string) {}
  }
  const engine = {
    getVoices: () => Array.from({ length: installed }, () => ({})),
    addEventListener: (_name: string, run: () => void) => listeners.push(run),
    speak: (one: Utterance) => {
      said.push({ text: one.text, lang: one.lang });
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
    /** Ends the sentence being read, the way the engine does. */
    finish: () => live.shift()?.onend?.(),
    /** The voice list arriving, which on Windows takes a moment. */
    voicesArrive: () => {
      installed = 2;
      listeners.splice(0).forEach((run) => run());
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
      speak("A tornado warning, two miles away", "home");
      speak("A flood warning, at the school", "school");
      expect(engine.said.map((one) => one.text)).toEqual([
        "A tornado warning, two miles away",
      ]);
      engine.finish();
      expect(engine.said).toHaveLength(2);
      expect(engine.said[1].text).toBe("A flood warning, at the school");
    } finally {
      engine.undo();
    }
  });

  it("replaces a sentence still waiting for the same place", async () => {
    // Somebody whose watch has been upgraded to a warning wants the
    // warning, not both in the order they arrived.
    const engine = withSpeech(2);
    try {
      const { speak } = await freshSpeech();
      speak("Reading the first", "home");
      speak("A severe thunderstorm watch", "school");
      speak("A tornado warning", "school");
      engine.finish();
      engine.finish();
      expect(engine.said.map((one) => one.text)).toEqual([
        "Reading the first",
        "A tornado warning",
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
      speak("A tornado warning", "home");
      expect(engine.said).toHaveLength(0);
      engine.voicesArrive();
      expect(engine.said).toHaveLength(1);
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
    expect(() => speak("A tornado warning", "home")).not.toThrow();
    const again = withSpeech(2);
    try {
      speak("A flood warning", "home");
      expect(again.said.map((one) => one.text)).toEqual(["A flood warning"]);
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
      speak("Une alerte", "home");
      // `fr-CA` rather than `fr`: the app writes French for a reader in
      // Quebec, and a voice should read it that way too.
      expect(engine.said[0].lang).toBe("fr-CA");
      setLanguage("en");
    } finally {
      engine.undo();
    }
  });
});
