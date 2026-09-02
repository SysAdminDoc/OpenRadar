import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What the packaged window is allowed to ask the native side for.
 *
 * Tauri gates every plugin command per window against these files, and it
 * does it only in a packaged build: development serves the page from Vite,
 * and the end-to-end suite runs in a plain browser with no Tauri at all. So a
 * permission that is missing shows up for the first time in an installed app,
 * as a click that does nothing.
 *
 * That is not a hypothetical. Every `target="_blank"` link in the app was
 * dead in the shipped build because the opener plugin intercepts the click,
 * invokes `plugin:opener|open_url`, and the only capability granted
 * `reveal-item-in-dir`. Nothing failed anywhere: not the type checker, not
 * the unit suite, not the browser suite, which is why this file reads the
 * capability files rather than trusting them.
 */
const DIR = join(process.cwd(), "src-tauri", "capabilities");

interface Scoped {
  identifier: string;
  allow?: unknown[];
  deny?: unknown[];
}

interface Capability {
  identifier: string;
  windows?: string[];
  permissions: (string | Scoped)[];
}

const capabilities: Capability[] = readdirSync(DIR)
  .filter((name) => name.endsWith(".json"))
  .map((name) => JSON.parse(readFileSync(join(DIR, name), "utf8")));

/** Every capability whose window list covers this label. */
function covering(label: string): Capability[] {
  return capabilities.filter((capability) =>
    (capability.windows ?? []).some((pattern) =>
      new RegExp(`^${pattern.split("*").map(escape).join(".*")}$`).test(label),
    ),
  );
}

function escape(part: string): string {
  return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** What one window is granted, as a map from identifier to its scope. */
function granted(label: string): Map<string, Scoped> {
  const found = new Map<string, Scoped>();
  for (const capability of covering(label)) {
    for (const permission of capability.permissions) {
      const scoped =
        typeof permission === "string"
          ? { identifier: permission }
          : permission;
      found.set(scoped.identifier, scoped);
    }
  }
  return found;
}

describe("what the main window may ask for", () => {
  const main = granted("main");

  it("may open an external link", () => {
    expect(
      main.has("opener:allow-open-url"),
      "every target=_blank link in the app is dead without this",
    ).toBe(true);
  });

  it("opens https and nothing else", () => {
    // `opener:default` would pass this file and still be wrong: it carries
    // `allow-default-urls`, whose scope admits http, mailto and tel as well.
    expect(main.has("opener:default")).toBe(false);

    const scope = (main.get("opener:allow-open-url")?.allow ?? []) as {
      url?: string;
    }[];
    expect(scope.length, "an unscoped grant opens whatever it is handed").toBe(
      1,
    );
    for (const entry of scope) {
      expect(entry.url).toMatch(/^https:\/\//);
    }
  });

  it("still reveals a saved file in its folder", () => {
    expect(main.has("opener:allow-reveal-item-in-dir")).toBe(true);
  });

  it("never opens a path, which would run whatever it names", () => {
    expect(main.has("opener:allow-open-path")).toBe(false);
  });
});

describe("what the glance window may ask for", () => {
  const glance = granted("glance");

  it("can read the settings, so it speaks the reader's language", () => {
    // Tauri gates a plugin command per window. With only `main` named, the
    // small window's `Store.load` was rejected, `loadSettings` caught it and
    // answered with the defaults, and the window came up in English beside a
    // French workspace. Nothing failed anywhere: the app's own commands are
    // not gated, so `glance_read` kept working and the window looked fine.
    expect(glance.has("store:allow-load")).toBe(true);
    expect(glance.has("store:allow-get")).toBe(true);
  });

  it("is granted nothing it does not use", () => {
    // Least privilege, and the reason this window has its own capability
    // rather than being added to the default one: it would have inherited the
    // dialog, the updater, restart and notifications along with the store.
    for (const identifier of [
      "dialog:allow-open",
      "updater:default",
      "process:allow-restart",
      "notification:default",
      "opener:allow-open-url",
      "store:allow-set",
      "store:allow-save",
    ]) {
      expect(glance.has(identifier), identifier).toBe(false);
    }
  });
});
