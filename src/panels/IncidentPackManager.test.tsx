import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "../lib/settings";
import { en } from "../i18n/en";
import type { IncidentPack, IncidentPackLibrary } from "../lib/incidentPacks";
import type { UndoableRemoval } from "../components/ToastHost";

/**
 * Deleting a finished pack, and getting it back.
 *
 * A pack is a verified multi-megabyte download and the press that threw one
 * away had nothing behind it but a toast. What these hold: the undo is offered
 * for a finished pack and not for a cancelled download, taking it restores the
 * pack and its reference in settings, letting the window close throws the
 * held copy away, and neither the restore nor the reaping happens twice.
 */
const deletePack = vi.fn<(id: string) => Promise<boolean>>();
const restorePack = vi.fn<(id: string) => Promise<IncidentPack>>();
const reapPack = vi.fn<(id: string) => Promise<void>>();
const cancelPack = vi.fn<(id: string) => Promise<void>>();
const listPacks = vi.fn<() => Promise<IncidentPackLibrary>>();

vi.mock("../lib/incidentPacks", async () => {
  const real = await vi.importActual<typeof import("../lib/incidentPacks")>(
    "../lib/incidentPacks",
  );
  return {
    ...real,
    incidentPacksAvailable: () => true,
    listIncidentPacks: () => listPacks(),
    setIncidentPackLimit: () => listPacks(),
    estimateIncidentPack: () =>
      Promise.reject(new Error("no estimate in this test")),
    deleteIncidentPack: (id: string) => deletePack(id),
    cancelIncidentPack: (id: string) => cancelPack(id),
    restoreIncidentPack: (id: string) => restorePack(id),
    reapIncidentPack: (id: string) => reapPack(id),
  };
});

const { IncidentPackManager } = await import("./IncidentPackManager");

function pack(overrides: Partial<IncidentPack> = {}): IncidentPack {
  return {
    id: "aaaa1111bbbb2222cccc3333",
    name: "Des Moines",
    bounds: { west: -94, south: 41, east: -93, north: 42 },
    minZoom: 5,
    maxZoom: 9,
    status: "ready",
    tileCount: 24,
    downloadedTiles: 24,
    downloadedBytes: 1024,
    estimatedBytes: 1024,
    archiveBytes: 2048,
    sha256: "a".repeat(64),
    source: "USGS The National Map Topo",
    attribution: "USGS The National Map",
    error: null,
    createdAt: "2026-09-03T00:00:00Z",
    updatedAt: "2026-09-03T00:00:00Z",
    ...overrides,
  };
}

function library(packs: IncidentPack[]): IncidentPackLibrary {
  return { packs, usedBytes: 2048, diskLimitBytes: 4096 * 1024 * 1024 };
}

let removals: UndoableRemoval[] = [];
/** The basemap in use, as the workspace would hold it. */
let chosen: string | null = null;
/** Sets it the way another part of the workspace would, mid-window. */
let choose: ((id: string | null) => void) | null = null;

function Harness({ start }: { start: AppSettings }) {
  const [settings, setSettings] = useState(start);
  // In an effect, not in the render body: the lint rules here refuse a write
  // to anything declared outside the component, and an effect is where the
  // value is settled anyway.
  useEffect(() => {
    chosen = settings.incidentPacks.selectedId;
    choose = (id) =>
      setSettings((now) => ({
        ...now,
        incidentPacks: { ...now.incidentPacks, selectedId: id },
      }));
  }, [settings]);
  return (
    <IncidentPackManager
      settings={settings}
      bounds={null}
      onSettings={setSettings}
      onRemoved={(removal) => {
        removals.push(removal);
      }}
    />
  );
}

/** Settings with the pack below already in use as the basemap. */
function usingThePack(): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    incidentPacks: {
      ...DEFAULT_SETTINGS.incidentPacks,
      selectedId: pack().id,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  removals = [];
  chosen = null;
  choose = null;
  deletePack.mockReset().mockResolvedValue(true);
  cancelPack.mockReset().mockResolvedValue(undefined);
  reapPack.mockReset().mockResolvedValue(undefined);
  restorePack.mockReset().mockResolvedValue(pack());
  listPacks.mockReset().mockResolvedValue(library([pack()]));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function deleteTheReadyPack(inUse = false) {
  render(<Harness start={inUse ? usingThePack() : DEFAULT_SETTINGS} />);
  await waitFor(() => expect(screen.getByText("Des Moines")).toBeTruthy());
  // The listing is now empty, the way the native side would answer once the
  // pack has been moved aside.
  listPacks.mockResolvedValue(library([]));
  await act(async () => {
    fireEvent.click(screen.getByText(en["packs.delete"]));
  });
  await waitFor(() => expect(deletePack).toHaveBeenCalledTimes(1));
}

describe("deleting a finished incident pack", () => {
  it("offers an undo that restores the pack and its reference", async () => {
    await deleteTheReadyPack();
    expect(removals).toHaveLength(1);
    expect(removals[0].title).toContain("Des Moines");

    listPacks.mockResolvedValue(library([pack()]));
    await act(async () => {
      removals[0].undo();
    });
    await waitFor(() => expect(restorePack).toHaveBeenCalledWith(pack().id));
    await waitFor(() => expect(screen.getByText("Des Moines")).toBeTruthy());
    // The window is over as soon as the undo is taken, so nothing reaps the
    // pack that was just put back.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(reapPack).not.toHaveBeenCalled();
  });

  it("throws the held copy away when the window closes untouched", async () => {
    await deleteTheReadyPack();
    expect(reapPack).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(reapPack).toHaveBeenCalledTimes(1);
    expect(restorePack).not.toHaveBeenCalled();
  });

  it("does not restore twice when the undo is pressed again", async () => {
    await deleteTheReadyPack();
    listPacks.mockResolvedValue(library([pack()]));
    await act(async () => {
      removals[0].undo();
    });
    await waitFor(() => expect(restorePack).toHaveBeenCalledTimes(1));
    // A second press asks again, and the native side refuses because there is
    // nothing held any more. Nothing about the pack on screen changes.
    restorePack.mockRejectedValue(
      new Error("that incident pack was not found"),
    );
    await act(async () => {
      removals[0].undo();
    });
    await waitFor(() => expect(screen.getByText("Des Moines")).toBeTruthy());
  });
});

describe("cancelling a download that never finished", () => {
  it("offers no undo, because there is no archive to give back", async () => {
    listPacks.mockResolvedValue(
      library([pack({ status: "downloading", downloadedTiles: 3 })]),
    );
    render(<Harness start={DEFAULT_SETTINGS} />);
    await waitFor(() => expect(screen.getByText("Des Moines")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText(en["packs.cancel"]));
    });
    await waitFor(() => expect(cancelPack).toHaveBeenCalledTimes(1));
    expect(removals).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(reapPack).not.toHaveBeenCalled();
  });
});

describe("what an undo must not take back with it", () => {
  it("leaves a basemap the reader chose after the delete alone", () => {
    // The failure this replaces: `wasSelected` was captured when the pack went
    // and applied verbatim when Undo was pressed, so a reader who deleted the
    // pack in use, picked another, then changed their mind about the delete
    // had the second one switched off under them.
    return (async () => {
      // The pack that goes is the one in use, so the undo has a claim on the
      // basemap to press. Without that the branch under test never runs.
      await deleteTheReadyPack(true);
      // A different pack is now the basemap.
      act(() => choose?.("bbbb2222cccc3333dddd4444"));
      listPacks.mockResolvedValue(library([pack()]));
      await act(async () => {
        removals[0].undo();
      });
      await waitFor(() => expect(restorePack).toHaveBeenCalledTimes(1));
      expect(chosen).toBe("bbbb2222cccc3333dddd4444");
    })();
  });

  it("takes the basemap back when nothing else has claimed it", () => {
    // The other half. With no pack chosen since, the pack that was in use
    // comes back in use, which is what the reader deleted by accident.
    return (async () => {
      await deleteTheReadyPack(true);
      listPacks.mockResolvedValue(library([pack()]));
      await act(async () => {
        removals[0].undo();
      });
      await waitFor(() => expect(chosen).toBe(pack().id));
    })();
  });
});

describe("two deletes half a minute apart", () => {
  it("ends each pack's own window rather than the other's", () => {
    // Native holds one pack at a time, so a reap that took the whole held
    // folder would throw away the second pack while its own toast was still
    // on screen offering it back.
    return (async () => {
      await deleteTheReadyPack();
      const first = pack().id;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(reapPack).toHaveBeenCalledTimes(1);
      expect(reapPack).toHaveBeenCalledWith(first);
    })();
  });
});

describe("a pack whose state on screen is not its state on disk", () => {
  it("offers the undo the native side actually took", () => {
    // The listing is up to a second old, so the status the button was drawn
    // from is not what the delete acts on. Deciding the undo from the listing
    // left a pack held on disk that nothing on screen knew about and no timer
    // would ever reap; the native side's answer is the one that settles it.
    return (async () => {
      listPacks.mockResolvedValue(
        library([pack({ status: "paused", downloadedTiles: 12 })]),
      );
      deletePack.mockResolvedValue(true);
      render(<Harness start={DEFAULT_SETTINGS} />);
      await waitFor(() => expect(screen.getByText("Des Moines")).toBeTruthy());
      listPacks.mockResolvedValue(library([]));
      await act(async () => {
        fireEvent.click(screen.getByText(en["packs.delete"]));
      });
      await waitFor(() => expect(deletePack).toHaveBeenCalledTimes(1));
      expect(removals).toHaveLength(1);
    })();
  });

  it("offers nothing when the native side did not hold it", () => {
    return (async () => {
      deletePack.mockResolvedValue(false);
      await deleteTheReadyPack();
      expect(removals).toHaveLength(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(reapPack).not.toHaveBeenCalled();
    })();
  });
});
