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
