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
 * The rule is narrow on purpose. It reports a symbol NOTHING names, tests
 * included, and says nothing about one that only a test calls. There are a
 * hundred and fifty-five of those, and they are the shape this codebase is
 * deliberately written in: a rule extracted out of a hook or a component so a
 * test can drive the real thing rather than a copy of it. Removing those
 * exports would put the rules back inside the components and leave the tests
 * asserting models of them, which is the exact failure this project has
 * already been bitten by.
 *
 * Not a parser. It reads declarations and counts identifier occurrences,
 * which is enough for a codebase that exports named symbols and imports them
 * by name. Checked in both directions: the run fails if it finds implausibly
 * few exports, so a change that breaks the reading is not mistaken for a
 * clean tree.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

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

const declared = [];
for (const path of declaring) {
  const source = readFileSync(path, "utf8");
  for (const pattern of [
    /^export (?:async )?function \*?([A-Za-z0-9_]+)/gm,
    /^export (?:const|let) ([A-Za-z0-9_]+)/gm,
    /^export class ([A-Za-z0-9_]+)/gm,
    /^export (?:type|interface) ([A-Za-z0-9_]+)/gm,
  ]) {
    for (const match of source.matchAll(pattern)) {
      declared.push({ path, name: match[1] });
    }
  }
}

if (declared.length < 100) {
  console.error(
    `Only ${declared.length} exports were found, which says this stopped reading the tree rather than that the tree stopped exporting.`,
  );
  process.exit(1);
}

const said = new Map(files.map((path) => [path, readFileSync(path, "utf8")]));

const dead = [];
for (const { path, name } of declared) {
  const asked = new RegExp(`\\b${name}\\b`);
  const namedElsewhere = [...said].some(
    ([other, source]) => other !== path && asked.test(source),
  );
  if (namedElsewhere) continue;
  // Its own file may still use it; what makes it dead is that nothing else
  // in the tree, test or app, ever says the word.
  const own = said.get(path) ?? "";
  const times = (own.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
  if (times > 1) continue;
  dead.push(`${path.slice(ROOT.length + 1).replace(/\\/g, "/")}: ${name}`);
}

if (!dead.length) {
  console.log(`All ${declared.length} exports are named by something.`);
  process.exit(0);
}

console.error("Exported and never named, here or anywhere:\n");
for (const one of dead) console.error(`  ${one}`);
console.error("\nDelete it, or give it the caller it was written for.");
process.exit(1);
