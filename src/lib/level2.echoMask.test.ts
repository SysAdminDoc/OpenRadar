import { afterEach, describe, expect, it, vi } from "vitest";
import { level2Source } from "../test/rustSource";
import { fetchArchiveSweep, fetchLocalSweep, fetchSweep } from "./level2";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

afterEach(() => invoke.mockReset());

/**
 * Both halves of the echo mask's request, held to each other.
 *
 * A command whose argument the page does not send fails at the moment it is
 * called, with "missing required key", and the end-to-end suite runs in a
 * browser with no Tauri to call. So nothing but this would notice the page
 * spelling it one way and the native side another, and the mask has to reach
 * all three: the live sweep, the archive frames a loop plays beside it, and a
 * file the reader opened.
 */
describe("the echo mask reaches the native side", () => {
  it("is sent with every sweep the page asks for", async () => {
    invoke.mockResolvedValue({});
    await fetchSweep(
      "KTLX",
      "reflectivity",
      0,
      true,
      null,
      null,
      false,
      false,
      false,
      false,
      false,
      true,
      null,
    );
    await fetchArchiveSweep(
      "KTLX",
      "2026-09-23T03:10:00Z",
      "reflectivity",
      0,
      true,
      null,
      null,
      false,
      true,
      null,
    );
    await fetchLocalSweep(
      "C:/volumes/KTLX20260923_031000_V06",
      "reflectivity",
      0,
      true,
      null,
      null,
      false,
      true,
      null,
    );
    const asked = invoke.mock.calls.map(([command, payload]) => [
      command,
      (payload as Record<string, unknown>).echoMask,
    ]);
    expect(asked).toEqual([
      ["level2_sweep", true],
      ["level2_archive_sweep", true],
      ["level2_local_sweep", true],
    ]);
  });

  it("is a parameter of every command that answers one", () => {
    // Read off the native source, so a command that stops taking it is a
    // failing test here rather than a silent `false` in the picture.
    const source = level2Source();
    for (const command of [
      "level2_sweep",
      "level2_archive_sweep",
      "level2_local_sweep",
    ]) {
      const at = source.indexOf(`pub async fn ${command}(`);
      expect(at, command).toBeGreaterThan(-1);
      // Up to the return type: a parameter such as `Option<(f32, f32)>`
      // closes a bracket of its own long before the list does.
      const signature = source.slice(at, source.indexOf("->", at));
      expect(signature, command).toMatch(/\becho_mask: bool\b/);
      // And it goes into the look the sweep is drawn with. A command that
      // takes the switch and drops it compiles with a warning and draws every
      // sweep unmasked; the archive command doing that left the suite green.
      const next = source.indexOf("pub async fn ", at + 1);
      const body = source.slice(at, next === -1 ? undefined : next);
      expect(body, command).toMatch(/Look\s*\{[^}]*\becho_mask\b[^}]*\}/);
    }
  });
});
