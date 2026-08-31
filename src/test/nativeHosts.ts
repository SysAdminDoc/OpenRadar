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
