import type { SurfaceId, ToolMode } from "../components/CommandBar";
import { useEffect } from "react";

/**
 * Escape, from anywhere a panel did not already handle it.
 *
 * A panel stops its own Escape and a native listener on `window` sits above
 * the root React attaches to, so this never runs twice for one press.
 *
 * One press dismisses one thing, and the order is the order somebody would
 * name them. A full-screen mode goes first and takes nothing else with it.
 * The panel goes before the tool, because a tool and a surface can be open
 * together and `handleTool(null)` is the Clear button, which also wipes
 * whatever has been drawn: taking the tool first meant a single press closed
 * the panel, put the tool away and erased the reader's measurement, three
 * things they asked for one of.
 */
export interface EscapeKeyOptions {
  activeSurface: SurfaceId;
  activeTool: ToolMode;
  ambientScreen: boolean;
  capture: boolean;
  productOpen: boolean;
  handleTool: (tool: ToolMode) => void;
  setActiveSurface: (surface: SurfaceId) => void;
  setProductOpen: (open: boolean) => void;
  setAmbientAsked: (asked: boolean) => void;
  setCapture: (on: boolean) => void;
  setTouchedAt: (at: number) => void;
}

export function useEscapeKey({
  activeSurface,
  activeTool,
  ambientScreen,
  capture,
  productOpen,
  handleTool,
  setActiveSurface,
  setProductOpen,
  setAmbientAsked,
  setCapture,
  setTouchedAt,
}: EscapeKeyOptions): void {
  /**
   * Escape, from anywhere the panel did not already handle it.
   *
   * A panel stops its own Escape (`PanelShell`), and a native listener on
   * `window` sits above the root React attaches to, so this never runs twice
   * for one press: checked in a browser rather than assumed. What it covers
   * is everywhere else. A reader who opened Layers, tabbed out to the map and
   * pressed Escape got nothing at all, and the drawing, range and section
   * tools had no keyboard way out: the only exit was the Clear button in the
   * tool strip, which is a mouse target.
   *
   * One press dismisses one thing. The panel goes first, and only if there
   * is no panel does the tool go: a tool and a surface can be open together,
   * and `handleTool(null)` is the Clear button, which also wipes whatever has
   * been drawn. Taking the tool first meant a single Escape closed the panel,
   * put the tool away and erased the reader's measurement, three things they
   * asked for one of.
   *
   * A full-screen mode goes first and takes nothing else with it: one press
   * leaves the mode, and the next press is about the workspace underneath.
   *
   * This used to return without doing anything, under a comment saying the
   * press was already what left them. It was not. Entering either mode from
   * the command list clears the tool and the surface on the way in, so there
   * was nothing for the press to fall through to and nothing to protect; what
   * there was, was no way out but a 30 by 26 button, and only while it
   * happened to hold focus. A view entered by the idle timer did leave on any
   * key, because any key is what resets the idle clock; one asked for
   * deliberately did not leave on anything.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (ambientScreen) {
        setAmbientAsked(false);
        // Also counts as being here, which is what stops the idle rule
        // putting it straight back.
        setTouchedAt(Date.now());
        return;
      }
      if (capture) {
        setCapture(false);
        return;
      }
      if (activeSurface || productOpen) {
        setActiveSurface(null);
        setProductOpen(false);
        return;
      }
      if (activeTool) handleTool(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    activeTool,
    activeSurface,
    ambientScreen,
    capture,
    productOpen,
    handleTool,
    setActiveSurface,
    setAmbientAsked,
    setCapture,
    setProductOpen,
    setTouchedAt,
  ]);
}
