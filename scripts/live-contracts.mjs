#!/usr/bin/env node
/**
 * Runs every live provider contract, one at a time, and says what answered.
 *
 * `npm run check:live`, or `npm run check:live -- --json` for the machine
 * readable form. The normal gate stays offline; this is the one that asks the
 * services themselves whether the paths and schemas this app was built against
 * are still what they are serving.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  CONTRACT_GAP_MS,
  CONTRACT_TIMEOUT_MS,
  LIVE_CONTRACTS,
  cargoRanCount,
  classifyRun,
  exitCodeFor,
  refuseToRun,
  resolveCargo,
  summarize,
  vitestRanCount,
} from "./live-contracts-lib.mjs";

const CARGO = resolveCargo(process.env, (candidate) =>
  fs.existsSync(candidate),
);

/**
 * Vitest's own entry, run through this Node rather than through a shell.
 *
 * Windows ships npm's binaries as `.cmd` wrappers, and Node refuses to spawn
 * one without a shell. Turning the shell on to get around that hands the
 * arguments to a command line to re-parse, which is both deprecated and a way
 * to lose a path with a space in it. The module is right there in the tree.
 */
const VITEST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "node_modules",
  "vitest",
  "vitest.mjs",
);

const jsonOnly = process.argv.includes("--json");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);

function say(line) {
  if (!jsonOnly) process.stdout.write(`${line}\n`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs one command and collects what it said.
 *
 * The output is captured rather than inherited because the count of tests that
 * actually ran is read back out of it, and a contract that runs nothing has to
 * be reported as skipped rather than passed.
 */
function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, OPENRADAR_LIVE: "1" },
    });
    let output = "";
    let timedOut = false;
    let missingRunner = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, CONTRACT_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut, missingRunner });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      // The runner itself is not here, which is a fact about this machine.
      missingRunner = error.code === "ENOENT";
      resolve({
        code: 1,
        output: `${output}\n${error.message}`,
        timedOut,
        missingRunner,
      });
    });
  });
}

async function main() {
  const refusal = refuseToRun(process.env);
  if (refusal) {
    process.stderr.write(`${refusal}\n`);
    process.exit(2);
  }

  const wanted = only
    ? LIVE_CONTRACTS.filter((contract) => contract.id === only)
    : LIVE_CONTRACTS;
  if (!wanted.length) {
    process.stderr.write(`No contract matches ${only}.\n`);
    process.exit(2);
  }

  const startedAt = Date.now();
  const results = [];
  say(`Checking ${wanted.length} live provider contracts.\n`);

  for (const [index, contract] of wanted.entries()) {
    // Spacing between contracts, not before the first one.
    if (index > 0) await wait(CONTRACT_GAP_MS);
    const at = Date.now();
    const finished =
      contract.kind === "native"
        ? await run(
            CARGO,
            ["test", "--lib", "--", "--ignored", contract.filter],
            "src-tauri",
          )
        : await run(
            process.execPath,
            // Only the live block, by name. Running the whole file counts its
            // offline tests too, so a live block that had been skipped or
            // renamed still reported a healthy count and the "ran nothing"
            // guard never fired. Narrowing the run is what makes a count of
            // zero mean the provider genuinely went unasked.
            [VITEST, "run", ...contract.files, "-t", contract.liveBlock],
            ".",
          );
    const ranCount =
      contract.kind === "native"
        ? cargoRanCount(finished.output)
        : vitestRanCount(finished.output);
    const status = classifyRun({
      code: finished.code,
      timedOut: finished.timedOut,
      ranCount,
      missingRunner: finished.missingRunner,
    });
    results.push({
      id: contract.id,
      label: contract.label,
      host: contract.host,
      kind: contract.kind,
      required: contract.required,
      status,
      ranCount,
      durationMs: Date.now() - at,
      // Only the tail, and only when something went wrong. A passing contract
      // does not need a page of output, and a failing one needs the end of it.
      detail:
        status === "fail"
          ? finished.output.trim().split("\n").slice(-12).join("\n")
          : undefined,
    });
    const mark = { pass: "ok", fail: "FAILED", skip: "skipped" }[status];
    say(
      `  ${contract.id.padEnd(11)} ${mark.padEnd(8)} ${ranCount} ran · ${contract.host}`,
    );
    if (status === "fail") say(`${results.at(-1).detail}\n`);
  }

  const summary = summarize(results, startedAt, Date.now());
  if (jsonOnly) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    const { pass, fail, skip } = summary.counts;
    say(`\n${pass} passed, ${fail} failed, ${skip} skipped.`);
  }
  process.exit(exitCodeFor(results));
}

void main();
