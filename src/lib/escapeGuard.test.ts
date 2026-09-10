import { describe, expect, it } from "vitest";
import { workspaceSource } from "../test/workspaceSource";

/**
 * The workspace's Escape handler's own body, read as text.
 *
 * Two of the three things this holds cannot be driven from a browser test.
 * Entering either full-screen mode from the command palette deliberately
 * clears the tool and the surface first, so by the time the mode is on there
 * is nothing left for a stray Escape to take; the state worth protecting only
 * exists on the idle path, which engages after a configured number of minutes
 * of nobody touching the machine. Rather than sit through that, the guard is
 * pinned where it is written.
 *
 * Read out of the workspace as a whole rather than out of `App.tsx`: the
 * handler moved into a hook beside it on 2026-09-09, and where it lives is
 * not what this is about.
 */
function escapeHandler(): string {
  const source = workspaceSource();
  const at = source.indexOf('if (event.key !== "Escape"');
  expect(at).toBeGreaterThan(-1);
  const rest = source.slice(at);
  const end = rest.indexOf("window.addEventListener");
  expect(end).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

describe("what one Escape is allowed to dismiss", () => {
  /**
   * This used to assert the opposite: `if (capture || ambientScreen) return;`,
   * under a comment saying "the same press is already what leaves them". That
   * was not true of either mode. Neither of the app's two Escape handlers left
   * a full-screen view, so the only way out was a leave button, and only while
   * it happened to hold focus. The guard was pinning the defect.
   *
   * What it holds now is the rule the modes actually need: the press leaves
   * the mode and stops there, so it cannot fall through and take the panel or
   * the tool with it. Driven end to end as well, in `ambient-screen.spec.ts`
   * and `capture.spec.ts`; this is here because the ORDER of the branches is
   * the part a browser cannot see.
   */
  it("leaves a full-screen mode, and takes nothing else with it", () => {
    const body = escapeHandler();
    const ambient = body.indexOf("if (ambientScreen)");
    const capture = body.indexOf("if (capture)");
    const surface = body.indexOf("setActiveSurface(null)");
    expect(ambient).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(-1);
    // Both before the workspace's own branches, and both returning, or one
    // press would leave the mode and then clear what the mode was holding.
    expect(ambient).toBeLessThan(surface);
    expect(capture).toBeLessThan(surface);
    expect(body).toMatch(/setAmbientAsked\(false\);[\s\S]*?return;/);
    expect(body).toMatch(/setCapture\(false\);\s*return;/);
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
