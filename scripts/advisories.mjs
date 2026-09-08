#!/usr/bin/env node
/**
 * Asks an advisory database about every crate in the lock, under both of the
 * names it could be filed under.
 *
 * `npm run check:advisories`. A network gate, so it sits beside
 * `check:live` rather than inside `npm run check`.
 *
 * `cargo audit` reads RustSec and is the first thing to run; this is the
 * second opinion for the case that started it. GHSA-qwgh-2vcv-g2f7, against
 * `block_buffer`, was published in August 2026 with no RustSec entry, and
 * `cargo audit`, grype and osv-scanner all reported this tree clean. The last
 * two query databases that hold it. crates.io treats a dash and an underscore
 * as the same character in a package name and the databases do not, so a
 * question about `block-buffer` is answered "nothing known" while the
 * advisory sits under `block_buffer`.
 *
 * What it does not do is decide whether an advisory matters. That is written
 * down by hand in the allowance file, with the evidence and a date to look
 * again, and this fails on anything not in it.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  FEWEST_PLAUSIBLE_CRATES,
  QUESTIONS_AT_ONCE,
  allowanceIn,
  askedFor,
  batchBody,
  cratesIn,
  hits,
  verdict,
} from "./advisories-lib.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = path.join(ROOT, "src-tauri", "Cargo.lock");
const ALLOWANCE = path.join(ROOT, "src-tauri", ".cargo", "advisories.txt");
const OSV = "https://api.osv.dev/v1/querybatch";
const TIMEOUT_MS = 30_000;

/** One batch of questions, or a thrown error naming what went wrong. */
async function ask(asked) {
  const answer = await fetch(OSV, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(batchBody(asked)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!answer.ok) {
    throw new Error(`${OSV} answered ${answer.status}`);
  }
  const body = await answer.json();
  const results = body?.results;
  if (!Array.isArray(results) || results.length !== asked.length) {
    throw new Error(
      `${OSV} answered ${results?.length ?? "nothing"} times to ${asked.length} questions`,
    );
  }
  return results;
}

async function main() {
  const lock = fs.readFileSync(LOCK, "utf8");
  const crates = cratesIn(lock);
  // A lock that stops parsing reports a clean tree, which is the one failure
  // here that looks exactly like passing.
  if (crates.length < FEWEST_PLAUSIBLE_CRATES) {
    console.error(
      `Only ${crates.length} crates were read out of ${LOCK}. That is too few to be the whole lock, so the reading is broken rather than the tree being small.`,
    );
    process.exit(2);
  }

  const allowanceText = fs.existsSync(ALLOWANCE)
    ? fs.readFileSync(ALLOWANCE, "utf8")
    : "";
  const {
    allowed,
    unexplained: silenced,
    malformed,
  } = allowanceIn(allowanceText);
  if (silenced.length) {
    console.error(
      `These are listed in ${ALLOWANCE} with nothing written above them:\n  ${silenced.join("\n  ")}\nAn allowance is a claim. Write the evidence and a date to look again above it.`,
    );
    process.exit(2);
  }
  if (malformed.length) {
    console.error(
      `These carry something after the identifier that is not a readable clause:\n  ${malformed.join("\n  ")}\nThe form is \`needs <crate> <version> [<crate> <version>...]\`. A clause nobody can read used to parse as no condition at all, which left the allowance holding for ever.`,
    );
    process.exit(2);
  }

  const asked = askedFor(crates);
  const results = [];
  for (let at = 0; at < asked.length; at += QUESTIONS_AT_ONCE) {
    const batch = asked.slice(at, at + QUESTIONS_AT_ONCE);
    // Only where a carriage return means something. Piped into a log, the
    // progress line never clears and every step of it is kept instead.
    if (process.stdout.isTTY) {
      process.stdout.write(
        `asking about ${at + batch.length} of ${asked.length}\r`,
      );
    }
    results.push(...(await ask(batch)));
  }
  if (process.stdout.isTTY) process.stdout.write(`${" ".repeat(40)}\r`);

  const found = hits(asked, results);
  const { unexplained, explained, stale, voided } = verdict(
    found,
    allowed,
    crates,
  );

  console.log(
    `${crates.length} crates, ${asked.length} questions, ${found.length} advisories.`,
  );
  for (const one of explained) {
    console.log(
      `  allowed  ${one.id}  ${one.crate} ${one.version} (filed as ${one.spelling})`,
    );
  }
  for (const [id, missing] of voided) {
    console.log(
      `  VOID     ${id} is allowed for on the strength of ${missing
        .map((one) => `${one.crate} ${one.version}`.trim())
        .join(", ")}, which the lock no longer holds`,
    );
  }
  for (const id of stale) {
    console.log(
      `  stale    ${id} is allowed for and nothing in the tree answers to it any more`,
    );
  }
  for (const one of unexplained) {
    // No summary line: `querybatch` answers with an identifier and a modified
    // time and nothing else, so one was promised and could never be printed.
    // Reading it needs a second call per advisory to `/v1/vulns/{id}`, which
    // is a request per finding on a path that usually finds nothing.
    console.log(
      `  FOUND    ${one.id}  ${one.crate} ${one.version} (filed as ${one.spelling})`,
    );
  }

  if (unexplained.length) {
    console.error(
      `\n${unexplained.length} advisory${unexplained.length === 1 ? "" : " entries"} with no allowance. Fix the dependency, or write down in ${ALLOWANCE} why it cannot reach anything here.`,
    );
    process.exit(1);
  }
  console.log("Nothing outstanding.");
}

main().catch((failure) => {
  console.error(`The advisory check could not run: ${failure.message}`);
  process.exit(2);
});
