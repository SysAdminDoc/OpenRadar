/**
 * What the unused-exports gate actually decides, with the filesystem outside.
 *
 * The script was a straight-line program that walked `src/` and exited, so
 * nothing had ever watched it fail. That matters more here than in most
 * gates, because the rule is a word search over stripped text and the ways it
 * can quietly stop finding anything are all invisible: a pattern that no
 * longer matches a declaration reports a clean tree, and so does a stripper
 * that swallows the file it was reading.
 *
 * Nothing here reads or writes anything.
 */

/**
 * A file's code, with its line comments out of the way.
 *
 * The scan is a word search, and a word search over raw text finds a symbol
 * named in a comment: `Appearance` is an export and also the English for a
 * settings heading, `Flash` is a type and also half of "Flash Flood Warning".
 * Each was permanently unreportable.
 *
 * Block comments are deliberately NOT stripped, and the reason is worth
 * keeping: a route glob such as `"http://cached.localhost/**"` opens what
 * looks like one and it runs to the next real close, which took thirty-two
 * thousand characters of live code out of the scan. A symbol named only
 * inside a block comment is a false negative; a symbol hidden by one is a
 * false positive that fails the build.
 *
 * The leading group keeps a `://` from reading as a comment, which is what
 * makes a URL in code survive.
 */
export function code(source) {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The four shapes an export is written in here, as source rather than as
 * compiled expressions.
 *
 * Built fresh for every file, which is what the loop these came out of did by
 * writing the literals inside it. A global expression carries its own
 * `lastIndex`, and while `matchAll` is specified to work on a clone and was
 * measured here doing exactly that, a shared one is a footgun sitting in the
 * one place where going wrong looks like a clean tree: a gate that has stopped
 * finding anything reports that every export is named by something.
 *
 * `function* name` and `function *name` are the same declaration and only the
 * second was read. Nothing in the tree writes a generator export today, so
 * that was a hole rather than a miss, and a hole in a word search is a symbol
 * that can never be reported.
 */
export const DECLARATIONS = [
  "^export (?:async )?function\\b(?:\\s*\\*)?\\s*([A-Za-z0-9_]+)",
  "^export (?:const|let) ([A-Za-z0-9_]+)",
  "^export class ([A-Za-z0-9_]+)",
  "^export (?:type|interface) ([A-Za-z0-9_]+)",
];

/** Every symbol one file exports, by the four shapes above. */
export function declarationsIn(path, source) {
  const found = [];
  for (const pattern of DECLARATIONS) {
    for (const match of source.matchAll(new RegExp(pattern, "gm"))) {
      found.push({ path, name: match[1] });
    }
  }
  return found;
}

/**
 * Which exports nothing in the tree ever names, and the shape of the rest.
 *
 * A symbol is reported when nothing else names it AND its own file names it
 * only once, which is the declaration. So it catches a symbol nobody anywhere
 * calls, and says nothing about the two much larger groups whose only caller
 * is a test or their own file. Both of those are the shape this codebase is
 * written in on purpose, and both are counted rather than written into a
 * comment, because a number in a comment is a number nobody updates.
 *
 * `said` maps a path to that file's stripped code. `isTest` decides which
 * paths count as a test, so the caller owns the naming convention.
 */
export function findDead({ declared, said, isTest }) {
  const dead = [];
  let testOnly = 0;
  let fileLocal = 0;
  for (const { path, name } of declared) {
    const word = new RegExp(`\\b${name}\\b`);
    const elsewhere = [...said].filter(
      ([other, source]) => other !== path && word.test(source),
    );
    if (elsewhere.length) {
      if (elsewhere.every(([other]) => isTest(other))) testOnly += 1;
      continue;
    }
    // Its own file may still use it; what makes it dead is that nothing else
    // in the tree, test or app, ever says the word.
    const own = said.get(path) ?? "";
    const times = (own.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
    if (times > 1) {
      fileLocal += 1;
      continue;
    }
    dead.push({ path, name });
  }
  return { dead, testOnly, fileLocal };
}

/**
 * The floor under how many exports a run has to find.
 *
 * Checked in both directions on purpose: a change that breaks the reading
 * finds nothing and would otherwise be mistaken for a clean tree.
 */
export const FEWEST_PLAUSIBLE = 100;
