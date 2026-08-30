import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CACHED_HOSTS } from "./tileCache";

/** Every host the native side may fetch, read from the Rust list itself. */
function allowedHosts(): string[] {
  const source = readFileSync(
    join(process.cwd(), "src-tauri", "src", "http.rs"),
    "utf8",
  );
  const list = source.slice(
    source.indexOf("const ALLOWED_HOSTS"),
    source.indexOf("const MAX_BODY_BYTES"),
  );
  return [...list.matchAll(/"([a-z0-9.-]+\.[a-z]{2,})"/g)].map(
    (match) => match[1],
  );
}

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

  it("allows every host the page fetches from directly", () => {
    // A host the page reaches without going through the cached scheme, which
    // is what happens in a browser preview and what happens for anything the
    // cache does not cover.
    for (const host of CACHED_HOSTS) {
      const allowed =
        csp["connect-src"].includes(`https://${host}`) ||
        csp["connect-src"].includes(
          `https://*.${host.split(".").slice(1).join(".")}`,
        );
      expect(allowed, `connect-src is missing ${host}`).toBe(true);
    }
  });

  it("names no host the code cannot reach", () => {
    // The other direction, and the one that rots quietly: a host left in the
    // policy after the code that fetched it is gone widens the packaged app
    // for nothing, and nothing else here would notice.
    const union = new Set([...allowedHosts(), ...CACHED_HOSTS]);

    // A wildcard is only honest when some code declares it trusts the whole
    // suffix. RainViewer hands out its own tile origin at runtime, and the
    // provider accepts any subdomain of rainviewer.com, so the policy has to
    // as well.
    const wildcards: Record<string, { file: string; trusts: string }> = {
      "*.rainviewer.com": {
        file: join("src", "lib", "providers", "rainviewer.ts"),
        trusts: 'host.endsWith(".rainviewer.com")',
      },
    };

    // Schemes, the local spellings Windows gives them, and the keywords.
    const notHosts =
      /^('self'|'wasm-unsafe-eval'|'unsafe-inline'|data:|blob:|ipc:|mrms:|cached:|asset:|customprotocol:|http:\/\/(ipc|mrms|cached|asset)\.localhost)$/;

    for (const directive of ["connect-src", "img-src", "font-src"]) {
      for (const token of csp[directive].split(/\s+/).filter(Boolean)) {
        if (notHosts.test(token)) continue;
        expect(token, `${directive} has an unexpected entry`).toMatch(
          /^https:\/\//,
        );
        const host = token.slice("https://".length);

        if (host.startsWith("*.")) {
          const declared = wildcards[host];
          expect(
            declared,
            `${directive} allows every subdomain of ${host.slice(2)} and no code says why`,
          ).toBeDefined();
          const source = readFileSync(
            join(process.cwd(), declared.file),
            "utf8",
          );
          expect(
            source.includes(declared.trusts),
            `${declared.file} no longer trusts ${host}, so the policy should not either`,
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

  it("does not let the page reach anything by default", () => {
    // The catch-all stays narrow: a directive that is forgotten should fail
    // closed rather than inherit the web.
    expect(csp["default-src"]).not.toContain("*");
    expect(csp["default-src"]).not.toContain("https:");
    expect(csp["script-src"]).not.toContain("unsafe-inline");
  });
});
