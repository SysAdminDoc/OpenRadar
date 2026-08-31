import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowedHosts } from "../test/nativeHosts";
import { CACHED_HOSTS } from "./tileCache";

/**
 * The ledger is a promise about what this app reaches and what that obliges.
 *
 * A promise nothing checks is a promise that rots. The version of this file
 * before 2026-08-31 named a bundled path that had not existed for two
 * releases and left out three hosts the app was actively fetching from,
 * including a whole country's radar. Both are the same failure: the ledger was
 * written by hand and the code moved underneath it.
 */

const root = process.cwd();
const ledger = readFileSync(join(root, "docs", "asset-ledger.md"), "utf8");

/** Every host named in a table row of the ledger, however many per row. */
function ledgerHosts(): string[] {
  const rows = ledger.split("\n").filter((line) => line.startsWith("| `"));
  const found: string[] = [];
  for (const row of rows) {
    const cell = row.slice(1, row.indexOf("|", 1));
    for (const match of cell.matchAll(/`([a-z0-9.-]+\.[a-z]{2,})`/g)) {
      found.push(match[1]);
    }
  }
  return found;
}

/** Every path the ledger claims is bundled with the app. */
function ledgerPaths(): string[] {
  return [...ledger.matchAll(/`(public\/[^`]+)`/g)].map((match) => match[1]);
}

describe("the asset ledger and the code it describes", () => {
  it("accounts for every host the native side may reach", () => {
    const listed = new Set(ledgerHosts());
    const missing = allowedHosts().filter((host) => !listed.has(host));
    expect(
      missing,
      `these hosts are fetched but not in the ledger: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  // The other direction. A host retired from the allowlist but left in the
  // ledger tells a reader the app still contacts something it cannot.
  it("does not claim hosts the native side cannot reach", () => {
    const allowed = new Set(allowedHosts());
    const extra = ledgerHosts().filter((host) => !allowed.has(host));
    expect(
      extra,
      `these hosts are in the ledger but not reachable: ${extra.join(", ")}`,
    ).toEqual([]);
  });

  // Cache routing is a third copy of the same knowledge, and the ledger states
  // a cache answer per host. Every routed host must at least be accounted for.
  it("covers every host the webview routes through the cache", () => {
    const listed = new Set(ledgerHosts());
    const missing = CACHED_HOSTS.filter((host) => !listed.has(host));
    expect(missing, `cached but unledgered: ${missing.join(", ")}`).toEqual([]);
  });

  // Presence was held from the start; the answer in the cell was not. A row
  // could say a host was never cached while the code routed it through the
  // cache, which is the ledger being wrong in the one column a reader would
  // consult it for.
  it("agrees with the code about which hosts are cached", () => {
    const routed = new Set<string>(CACHED_HOSTS);
    for (const row of ledger
      .split("\n")
      .filter((line) => line.startsWith("| `"))) {
      const cells = row.split("|").map((cell) => cell.trim());
      const host = /`([a-z0-9.-]+\.[a-z]{2,})`/.exec(cells[1] ?? "")?.[1];
      // Six-column runtime rows only; the bundled table is a different shape.
      if (!host || cells.length < 8) continue;
      const says = cells[5].toLowerCase().startsWith("yes");
      if (routed.has(host)) {
        expect(says, `${host} is routed through the cache`).toBe(true);
      }
    }
  });

  it("names only bundled paths that exist", () => {
    for (const path of ledgerPaths()) {
      expect(existsSync(join(root, path)), `${path} is in the ledger`).toBe(
        true,
      );
    }
  });

  // The columns the ledger promises to answer for every runtime host. A row
  // that quietly drops one is how "what the service learns" goes unanswered
  // for the next host somebody adds.
  it("answers every column for every runtime host", () => {
    const rows = ledger
      .split("\n")
      .filter((line) => line.startsWith("| `") && line.includes("|"));
    const runtime = rows.filter((row) => !row.includes("public/"));
    expect(runtime.length).toBeGreaterThan(0);
    for (const row of runtime) {
      const cells = row
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      expect(cells.length, row.slice(0, 60)).toBe(6);
      for (const cell of cells) {
        expect(
          cell.length,
          `empty cell in ${row.slice(0, 60)}`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
