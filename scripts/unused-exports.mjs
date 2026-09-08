/**
 * Exports nothing in the tree ever names.
 *
 * `noUnusedLocals` stops at the file boundary, so an exported symbol whose
 * last caller went away is invisible to every gate in the build: it
 * type-checks, it lints clean, and it drifts away from the code beside it
 * until somebody reads it and believes it. Four had, and the drift was real:
 * `nameOf` took a Map the app no longer holds names in, and `temperatureAt`
 * inverted a formula the file's own parcel code had stopped using.
 *
 * The rule is narrow, and it is worth being exact about how narrow. A symbol
 * is reported when NOTHING else in the tree names it AND its own file names it
 * only once, which is the declaration itself. So it catches a symbol nobody
 * anywhere calls, and it deliberately says nothing about two much larger
 * groups: the ones whose only caller is inside their own file, and the ones
 * whose only caller is a test. Both are counted and printed rather than
 * written down here, because a number in a comment is a number nobody
 * updates: these two were wrong by fifty-five and by two when they were last
 * measured, which made the paragraph read as a guess.
 *
 * Both of those are the shape this codebase is deliberately written in: a rule
 * extracted out of a hook or a component so a test can drive the real thing
 * rather than a copy of it, and exported so the test can reach it. Removing
 * those exports would put the rules back inside the components and leave the
 * tests asserting models of them, which is the exact failure this project has
 * already been bitten by. `docs/architecture.md` says so where somebody will
 * read it.
 *
 * Not a parser. It reads declarations and counts identifier occurrences,
 * which is enough for a codebase that exports named symbols and imports them
 * by name. Checked in both directions: the run fails if it finds implausibly
 * few exports, so a change that breaks the reading is not mistaken for a
 * clean tree.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import {
  FEWEST_PLAUSIBLE,
  code,
  declarationsIn,
  findDead,
} from "./unused-exports-lib.mjs";

const ROOT = join(import.meta.dirname, "..", "src");

/**
 * Files whose exports answer to something other than a caller in this tree.
 *
 * The catalogues are read by key rather than by symbol, and the entry points
 * are loaded by the bundler.
 */
const NOT_ASKED = [
  `i18n${sep}`,
  `test${sep}`,
  "main.tsx",
  "glance.tsx",
  "vite-env.d.ts",
];

function sources(from) {
  const found = [];
  for (const entry of readdirSync(from)) {
    const path = join(from, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sources(path));
      continue;
    }
    if (/\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

const files = sources(ROOT);
const declaring = files.filter(
  (path) =>
    !/\.test\.tsx?$/.test(path) &&
    !NOT_ASKED.some((part) => path.includes(part)),
);

/** A path as the report writes it: from `src/`, forward-slashed. */
const named = (path) =>
  path
    .slice(ROOT.length + 1)
    .split(sep)
    .join("/");

const declared = [];
for (const path of declaring) {
  declared.push(...declarationsIn(path, readFileSync(path, "utf8")));
}

if (declared.length < FEWEST_PLAUSIBLE) {
  console.error(
    `Only ${declared.length} exports were found, which says this stopped reading the tree rather than that the tree stopped exporting.`,
  );
  process.exit(1);
}

const said = new Map(
  files
    .filter((path) => !path.includes(`i18n${sep}`))
    .map((path) => [path, code(readFileSync(path, "utf8"))]),
);

const { dead, testOnly, fileLocal } = findDead({
  declared,
  said,
  isTest: (path) => /\.test\.[tj]sx?$/.test(path),
});

const shape = `${testOnly} are driven only by a test, ${fileLocal} only by their own file.`;

if (!dead.length) {
  console.log(
    `All ${declared.length} exports are named by something. ${shape}`,
  );
  process.exit(0);
}

console.error("Exported and never named, here or anywhere:\n");
for (const one of dead) {
  console.error(`  ${named(one.path)}: ${one.name}`);
}
console.error("\nDelete it, or give it the caller it was written for.");
process.exit(1);
