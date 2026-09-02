import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAppearance } from "./useAppearance";
import { DEFAULT_SETTINGS, type AppSettings } from "../lib/settings";
import { applyTheme, THEME_STYLE_ID, THEME_TOKENS } from "../lib/theme";
import { occasionTheme } from "../lib/occasions";

/** Mid-autumn in Dallas, which is inside a window and nowhere near an edge. */
const IN_AUTUMN = new Date(2026, 9, 20, 12).getTime();
/** A quiet week in September, which is inside no window at all. */
const PLAIN = new Date(2026, 8, 12, 12).getTime();

afterEach(() => applyTheme(null));

function look(settings: Partial<AppSettings>, clock: number, alert = false) {
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...settings };
  const { result } = renderHook(() => useAppearance(merged, clock, alert));
  const style = document.getElementById(THEME_STYLE_ID);
  return { showing: result.current.showing, css: style?.textContent ?? "" };
}

const AUTUMN_ACCENT = occasionTheme("autumn", "dark", "x")!.tokens.Accent;
/**
 * Read off the token table rather than written out.
 *
 * `theme.test.ts` fails on any file that names a theme property, which is how
 * it holds the boundary; a test of the thing that applies them is no
 * exception, and following the table is more honest than an exemption.
 */
const ACCENT = THEME_TOKENS.find(
  (token) => token.directive === "Accent",
)!.property;

describe("what the workspace is wearing", () => {
  it("puts the season on when its window is open", () => {
    const { showing, css } = look({}, IN_AUTUMN);
    expect(showing).toBe(true);
    expect(css).toContain(`${ACCENT}: ${AUTUMN_ACCENT};`);
  });

  it("is plain for most of the year", () => {
    const { showing, css } = look({}, PLAIN);
    expect(showing).toBe(false);
    expect(css).toBe("");
  });

  it("stands down while a warning is in force where the reader watches", () => {
    // The standing rule for everything in this part of the workspace. A map
    // with a warning on it is a serious instrument, and nothing arrives on it
    // uninvited for as long as the warning stands.
    const { showing, css } = look({}, IN_AUTUMN, true);
    expect(showing).toBe(false);
    expect(css).toBe("");
  });

  it("goes away for the year when it is sent away", () => {
    const { css } = look(
      {
        occasions: {
          ...DEFAULT_SETTINGS.occasions,
          declined: { autumn: 2026 },
        },
      },
      IN_AUTUMN,
    );
    expect(css).toBe("");
    // And comes back the next year, because declining is for one of them.
    const next = look(
      {
        occasions: {
          ...DEFAULT_SETTINGS.occasions,
          declined: { autumn: 2025 },
        },
      },
      IN_AUTUMN,
    );
    expect(next.css).toContain(ACCENT);
  });

  it("gives the plain workspace back the moment the switch goes off", () => {
    const { showing, css } = look(
      { occasions: { ...DEFAULT_SETTINGS.occasions, enabled: false } },
      IN_AUTUMN,
    );
    expect(showing).toBe(false);
    expect(css).toBe("");
  });

  it("never sits over a theme the reader chose", () => {
    // They asked for one and not the other.
    const mine = {
      name: "Mine",
      base: "dark" as const,
      tokens: { Accent: "#ff00ff" },
    };
    const { css } = look({ workspaceTheme: mine }, IN_AUTUMN);
    expect(css).toContain(`${ACCENT}: #ff00ff;`);
    expect(css).not.toContain(AUTUMN_ACCENT);
  });

  it("does not rebuild the theme when nothing about it moved", () => {
    // A settings read rebuilds the record of declined occasions, and a camera
    // move is a settings read, so depending on that object rewrote the theme
    // element twice a second through a pan.
    const settings: AppSettings = { ...DEFAULT_SETTINGS };
    const { rerender } = renderHook(
      ({ at }: { at: AppSettings }) => useAppearance(at, IN_AUTUMN, false),
      { initialProps: { at: settings } },
    );
    const element = document.getElementById(THEME_STYLE_ID);
    expect(element?.textContent).toContain(ACCENT);
    // Writing the rule replaces the element's text, so watching for that is
    // watching for the effect running again.
    // Read with `takeRecords` rather than from the callback: the callback is
    // a microtask and would not have run by the time this asserts.
    const watcher = new MutationObserver(() => {});
    watcher.observe(element!, { childList: true, characterData: true });
    // The same settings, freshly normalised, which is what every camera save
    // hands back: a new `declined` object holding exactly nothing.
    rerender({
      at: {
        ...settings,
        camera: { ...settings.camera, zoom: 6 },
        occasions: { ...settings.occasions, declined: {} },
      },
    });
    const rewrites = watcher.takeRecords().length;
    watcher.disconnect();
    expect(rewrites).toBe(0);
    expect(document.getElementById(THEME_STYLE_ID)).toBe(element);
  });

  it("follows the reader's own half of the world", () => {
    const south: AppSettings = {
      ...DEFAULT_SETTINGS,
      watch: {
        ...DEFAULT_SETTINGS.watch,
        enabled: true,
        center: [172.64, -43.53],
      },
    };
    const { result } = renderHook(() => useAppearance(south, IN_AUTUMN, false));
    expect(result.current.occasion).toBe("spring");
  });

  it("asks where the map is looking when nothing is watched", () => {
    // The watch's default centre is a place in Texas nobody chose, so a
    // reader with no watched place and the map over Canterbury was being
    // given the northern calendar for it.
    const looking: AppSettings = {
      ...DEFAULT_SETTINGS,
      watch: { ...DEFAULT_SETTINGS.watch, enabled: false },
      camera: { ...DEFAULT_SETTINGS.camera, center: [172.64, -43.53] },
    };
    const { result } = renderHook(() =>
      useAppearance(looking, IN_AUTUMN, false),
    );
    expect(result.current.occasion).toBe("spring");
  });
});
