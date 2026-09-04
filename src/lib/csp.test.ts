import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CACHED_HOSTS } from "./tileCache";
import { allowedHosts } from "../test/nativeHosts";

/**
 * The content security policy is the one thing in this project that cannot be
 * checked by running it here.
 *
 * Tauri serves the page itself in a packaged build and sets the policy as a
 * response header. In development the page comes from Vite over
 * http://127.0.0.1:1420, where Tauri sets no such header, and the end-to-end
 * suite runs in a plain browser with no Tauri at all. So a directive that is
 * missing shows up for the first time in an installed build, as a blank map.
 *
 * This reads the config and holds it to what the code actually asks for.
 */
const config = JSON.parse(
  readFileSync(join(process.cwd(), "src-tauri", "tauri.conf.json"), "utf8"),
) as { app: { security: { csp: Record<string, string> } } };

const csp = config.app.security.csp;

/** Every custom scheme registered in lib.rs, and what it is used for. */
const SCHEMES = [
  { scheme: "mrms", directives: ["connect-src", "img-src"] },
  // Tiles, glyphs, and the documents the overlays are drawn from all go
  // through this one, so it has to be allowed everywhere they are fetched.
  { scheme: "cached", directives: ["connect-src", "img-src", "font-src"] },
  // Completed PMTiles packs are exposed as local raster tiles.
  { scheme: "incident", directives: ["connect-src", "img-src"] },
];

describe("the packaged app's content security policy", () => {
  it("allows every scheme the native side registers", () => {
    const registered = readFileSync(
      join(process.cwd(), "src-tauri", "src", "lib.rs"),
      "utf8",
    );
    for (const { scheme, directives } of SCHEMES) {
      // The list here has to keep up with the code, not the other way round.
      expect(
        registered.includes(
          `register_asynchronous_uri_scheme_protocol("${scheme}"`,
        ),
        `${scheme} is no longer registered`,
      ).toBe(true);

      for (const directive of directives) {
        // Windows spells a custom scheme as a host on http, and everything
        // else spells it as a scheme, so both forms have to be allowed.
        expect(csp[directive], `${directive} is missing ${scheme}:`).toContain(
          `${scheme}:`,
        );
        expect(
          csp[directive],
          `${directive} is missing http://${scheme}.localhost`,
        ).toContain(`http://${scheme}.localhost`);
      }
    }
  });

  /**
   * Hosts the page calls itself and never routes through the cached scheme.
   *
   * Checking only `CACHED_HOSTS` left these two unguarded, which is the exact
   * shape of failure this file exists to catch: both are in the policy and in
   * the native allowlist, and deleting either from `connect-src` broke nothing
   * in the suite while it would have taken routing or place search off a
   * packaged build with no error anywhere.
   */
  const DIRECT_HOSTS = [
    "valhalla1.openstreetmap.de",
    "geocoding-api.open-meteo.com",
  ];

  it("allows every host the page fetches from directly", () => {
    // A host the page reaches without going through the cached scheme, which
    // is what happens in a browser preview and what happens for anything the
    // cache does not cover.
    for (const host of [...CACHED_HOSTS, ...DIRECT_HOSTS]) {
      const allowed =
        csp["connect-src"].includes(`https://${host}`) ||
        csp["connect-src"].includes(
          `https://*.${host.split(".").slice(1).join(".")}`,
        );
      expect(allowed, `connect-src is missing ${host}`).toBe(true);
    }
  });

  /**
   * Wildcards, and the code that says why each one is honest.
   *
   * RainViewer hands out its own tile origin at runtime and the provider
   * accepts any subdomain of rainviewer.com, so the policy has to as well.
   * Declared once and read by both checks below: an exemption written into
   * one of them on its own is a hole nothing measures.
   */
  const WILDCARDS: Record<string, { file: string; trusts: string }> = {
    "*.rainviewer.com": {
      file: join("src", "lib", "providers", "rainviewer.ts"),
      trusts: 'host.endsWith(".rainviewer.com")',
    },
  };

  const trustedWildcard = (host: string) => {
    const declared = WILDCARDS[host];
    if (!declared) return false;
    const source = readFileSync(join(process.cwd(), declared.file), "utf8");
    expect(
      source.includes(declared.trusts),
      `${declared.file} no longer trusts ${host}, so the policy should not either`,
    ).toBe(true);
    return true;
  };

  it("lets the page reach only what the page itself fetches", () => {
    // The other direction from the test below, and stricter. That one lets a
    // host through if EITHER Rust or the page can reach it, so two S3 buckets
    // that only ever get fetched natively sat in `connect-src` widening the
    // page's allowance for nothing. What the page may reach is what the page
    // routes through the cached scheme, plus the two it fetches directly.
    const pageMay = new Set([...CACHED_HOSTS, ...DIRECT_HOSTS]);
    const extra: string[] = [];
    // Every directive the page pulls remote bytes over, not connect-src on
    // its own: a tile host reaches the page under img-src and a glyph range
    // under font-src, so a host added to either widens the page just as far.
    for (const directive of ["connect-src", "img-src", "font-src"]) {
      for (const token of csp[directive].split(/\s+/).filter(Boolean)) {
        if (!token.startsWith("https://")) continue;
        const host = token.slice("https://".length);
        if (trustedWildcard(host)) continue;
        if (!pageMay.has(host)) extra.push(`${directive}: ${host}`);
      }
    }
    expect(extra).toEqual([]);
  });

  it("names no host the code cannot reach", () => {
    // The other direction, and the one that rots quietly: a host left in the
    // policy after the code that fetched it is gone widens the packaged app
    // for nothing, and nothing else here would notice.
    const union = new Set([...allowedHosts(), ...CACHED_HOSTS]);

    // Schemes, the local spellings Windows gives them, and the keywords.
    const notHosts =
      /^('self'|'wasm-unsafe-eval'|'unsafe-inline'|data:|blob:|ipc:|mrms:|cached:|incident:|asset:|customprotocol:|http:\/\/(ipc|mrms|cached|incident|asset)\.localhost)$/;

    for (const directive of ["connect-src", "img-src", "font-src"]) {
      for (const token of csp[directive].split(/\s+/).filter(Boolean)) {
        if (notHosts.test(token)) continue;
        expect(token, `${directive} has an unexpected entry`).toMatch(
          /^https:\/\//,
        );
        const host = token.slice("https://".length);

        if (host.startsWith("*.")) {
          // A wildcard is only honest when some code declares it trusts the
          // whole suffix.
          expect(
            trustedWildcard(host),
            `${directive} allows every subdomain of ${host.slice(2)} and no code says why`,
          ).toBe(true);
          continue;
        }

        expect(
          union.has(host),
          `${directive} allows ${host}, which is in neither ALLOWED_HOSTS nor CACHED_HOSTS`,
        ).toBe(true);
      }
    }
  });

  it("still lets the basemap fetch its sprites and glyphs", () => {
    // connect-src is not the whole story. A vector style pulls its sprite
    // sheet under img-src and its glyph ranges under font-src, and a policy
    // that dropped either would leave a map with no labels in a packaged build
    // and nowhere else, which is the failure this file exists to prevent.
    const styles = readFileSync(
      join(process.cwd(), "src", "lib", "mapStyles.ts"),
      "utf8",
    );
    const hosts = new Set(
      [...styles.matchAll(/https:\/\/([a-z0-9.-]+)\/styles\//g)].map(
        (match) => match[1],
      ),
    );
    expect(hosts.size, "no basemap style host was found").toBeGreaterThan(0);

    for (const host of hosts) {
      for (const directive of ["img-src", "font-src"]) {
        expect(
          csp[directive].includes(`https://${host}`),
          `${directive} is missing ${host}, so the basemap loses its ${
            directive === "font-src" ? "labels" : "icons"
          }`,
        ).toBe(true);
      }
    }
  });

  it("does not let the page reach anything by default", () => {
    // The catch-all stays narrow: a directive that is forgotten should fail
    // closed rather than inherit the web.
    expect(csp["default-src"]).not.toContain("*");
    expect(csp["default-src"]).not.toContain("https:");
    expect(csp["script-src"]).not.toContain("unsafe-inline");
  });

  it("pins where a relative address resolves and refuses a form", () => {
    // Neither of these falls back to `default-src`, so leaving them out
    // leaves them unset. An injected `<base>` cannot redirect a script here,
    // because `script-src` carries no `unsafe-inline` and Tauri nonces what
    // it serves, but it can move every relative address on the page: the
    // basemap's own sprites and glyphs are fetched that way. There is no
    // form in this app and nowhere for one to post to.
    expect(csp["base-uri"]).toBe("'self'");
    expect(csp["form-action"]).toBe("'none'");
  });
});
