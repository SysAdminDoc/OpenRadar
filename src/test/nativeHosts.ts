import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every host the native side may fetch, read from the Rust list itself.
 *
 * Two separate checks hold things to this list: the content security policy
 * has to name what the page fetches, and the asset ledger has to account for
 * every address the app reaches. Both have to read the same source of truth,
 * because a second hand-maintained copy of a list is the thing that goes
 * stale without anybody noticing.
 */
/**
 * Every host the PAGE may fetch, read from the content security policy.
 *
 * The native allowlist and the policy are two different boundaries: a browser
 * adapter's requests go through the policy and never touch the Rust list.
 * Anything that has to ask "can the app reach this at all" has to ask both.
 */
export function policyHosts(): string[] {
  const source = readFileSync(
    join(process.cwd(), "src-tauri", "tauri.conf.json"),
    "utf8",
  );
  const config = JSON.parse(source) as {
    app?: { security?: { csp?: string | Record<string, unknown> } };
  };
  const csp = config.app?.security?.csp;
  const text = typeof csp === "string" ? csp : JSON.stringify(csp ?? "");
  return [
    ...new Set(
      [...text.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)].map(
        (match) => match[1],
      ),
    ),
  ];
}

export function allowedHosts(): string[] {
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
