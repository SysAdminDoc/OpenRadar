import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./MapOptionsPanels";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { en } from "../i18n/en";
import type { NotifyPermission } from "../lib/notify";

afterEach(cleanup);

/**
 * The line that says a watch cannot reach the reader.
 *
 * A refused permission drops all three watches to an in-app toast, which is
 * exactly what somebody looking away from the screen never sees. Settings is
 * where a reader goes after a warning did not arrive, so the sentence has to
 * be there and not only in the report they would have to know to copy.
 */
/**
 * A workspace with exactly one of the three notifying switches on.
 *
 * `watch.enabled` is home's own flag and only the first of them, which is
 * what the sentence was gated on: a reader with home off and a school
 * watched, or with only the lightning rule on, had notices being dropped
 * with nothing anywhere saying so.
 */
function settingsWith(on: "home" | "place" | "approach" | "lightning" | null) {
  return {
    ...DEFAULT_SETTINGS,
    watch: { ...DEFAULT_SETTINGS.watch, enabled: on === "home" },
    watchPlaces:
      on === "place"
        ? [
            {
              ...DEFAULT_SETTINGS.watch,
              enabled: true,
              id: "school",
              name: "School",
            },
          ]
        : [],
    approach: { ...DEFAULT_SETTINGS.approach, enabled: on === "approach" },
    lightningWatch: {
      ...DEFAULT_SETTINGS.lightningWatch,
      enabled: on === "lightning",
    },
  };
}

function panel(
  notifications: NotifyPermission | undefined,
  on: "home" | "place" | "approach" | "lightning" | null = "home",
) {
  return (
    <SettingsPanel
      settings={settingsWith(on)}
      onSettings={vi.fn()}
      onRemoved={vi.fn()}
      autostart={null}
      onAutostart={vi.fn()}
      notifications={notifications}
      onWatchHere={vi.fn()}
      onAddWatchPlace={vi.fn()}
      onSendWatchTest={vi.fn()}
      ambient={{ seen: null, dropped: false }}
      onJournalSaved={vi.fn()}
      onJournalFailed={vi.fn()}
      onImportSettings={vi.fn()}
      onStorageCleared={vi.fn()}
      onStorageFailed={vi.fn()}
      onJournalCleared={vi.fn()}
      onJournalRemoved={vi.fn()}
      onChooseSound={vi.fn()}
      clock={0}
      onReset={vi.fn()}
      onExportSettings={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

describe("what the watch settings say about Windows notifications", () => {
  it("says so, and where to turn them on, when Windows has refused", () => {
    render(panel("refused"));
    const said = screen.getByText(en["watch.notificationsRefused"]);
    expect(said).toBeTruthy();
    // Named so a browser test can find it without matching prose.
    expect(said.getAttribute("data-notifications-refused")).not.toBeNull();
    // The sentence has to carry the way out, not only the bad news.
    expect(en["watch.notificationsRefused"]).toContain("Windows Settings");
  });

  it("says nothing when they are allowed, or when nobody has asked", () => {
    // "Not asked for yet" is the ordinary state of a workspace whose watches
    // have not needed to raise anything, and a warning about it would be a
    // warning on every quiet afternoon.
    for (const answer of ["granted", "unasked", undefined] as const) {
      cleanup();
      render(panel(answer));
      expect(screen.queryByText(en["watch.notificationsRefused"])).toBeNull();
    }
  });

  it("says nothing while no watch is on, refused or not", () => {
    // With every watch off there is no channel being blocked. Saying Windows
    // will not let a notification through is true and useless: nothing is
    // trying to send one, and the sentence would sit in the settings of a
    // reader who never asked to be told anything.
    render(panel("refused", null));
    expect(screen.queryByText(en["watch.notificationsRefused"])).toBeNull();
  });

  it("says so for any of the three switches that can notify", () => {
    // Home's own flag is only the first of them. A reader who watches a
    // school rather than home, or who only wants to hear about lightning,
    // is having notices dropped through the same channel, and the sentence
    // was gated on a switch they had deliberately left off.
    for (const on of ["place", "approach", "lightning"] as const) {
      cleanup();
      render(panel("refused", on));
      expect(
        screen.queryByText(en["watch.notificationsRefused"]),
        `nothing said with only the ${on} watch on`,
      ).not.toBeNull();
    }
  });
});
