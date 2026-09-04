import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The app-root Escape handler's own body, read as text.
 *
 * Two of the three things this holds cannot be driven from a browser test.
 * Entering either full-screen mode from the command palette deliberately
 * clears the tool and the surface first, so by the time the mode is on there
 * is nothing left for a stray Escape to take; the state worth protecting only
 * exists on the idle path, which engages after a configured number of minutes
 * of nobody touching the machine. Rather than sit through that, the guard is
 * pinned where it is written.
 */
function escapeHandler(): string {
  const source = readFileSync(
    join(import.meta.dirname, "..", "App.tsx"),
    "utf8",
  );
  const at = source.indexOf('if (event.key !== "Escape"');
  expect(at).toBeGreaterThan(-1);
  const rest = source.slice(at);
  const end = rest.indexOf("window.addEventListener");
  expect(end).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

describe("what one Escape is allowed to dismiss", () => {
  it("does nothing at all while a full-screen mode is on", () => {
    // Both modes promise the workspace comes back exactly as it was, the same
    // panel open and the same tool held, and the same press is already what
    // leaves them. A handler with no guard took the state the mode exists to
    // keep, on the way out of it.
    const body = escapeHandler();
    expect(body).toContain("if (capture || ambientScreen) return;");
  });

  it("takes the panel before the tool", () => {
    // `handleTool(null)` is the Clear button: it puts the tool away, closes
    // the surface and wipes what has been drawn. A tool and a panel can be
    // open at once, so reaching for the tool first meant one press did three
    // things, one of which was erasing a measurement nobody asked to lose.
    const body = escapeHandler();
    const surface = body.indexOf("setActiveSurface(null)");
    const tool = body.indexOf("handleTool(null)");
    expect(surface).toBeGreaterThan(-1);
    expect(tool).toBeGreaterThan(-1);
    expect(surface).toBeLessThan(tool);
    // And the panel branch returns, so one press cannot fall through into
    // the other.
    expect(body).toMatch(/setProductOpen\(false\);\s*return;/);
  });
});
