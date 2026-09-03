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
 * groups: the hundred and fifty whose only caller is inside their own file,
 * and the hundred and fifty-five whose only caller is a test.
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

/**
 * A file's code, with its comments and its catalogue strings out of the way.
 *
 * The scan is a word search, and a word search over raw text finds a symbol
 * named in a comment or, worse, in a translated string: `Appearance` is an
 * export in `useAppearance.ts` and also the English for a settings heading,
 * `Flash` is a type and also half of "Flash Flood Warning", and `Told` is a
 * type and also a word somebody used in a sentence. Each was permanently
 * unreportable. Stripping line comments is enough for those, and the
 * catalogues are dropped whole.
 *
 * Block comments are deliberately NOT stripped. A route glob such as
 * `"http://cached.localhost/**"` opens what looks like one and it runs to the
 * next real `*\/`: doing it took thirty-two thousand characters of live code
 * out of the scan, sixteen thousand of them from one spec, and any export
 * whose only mention fell inside a swallowed span would have been reported as
 * dead. A symbol named only in a block comment is a false negative; a symbol
 * hidden by one is a false positive that fails the build.
 */
function code(source) {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const said = new Map(
  files
    .filter((path) => !path.includes(`i18n${sep}`))
    .map((path) => [path, code(readFileSync(path, "utf8"))]),
);

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
