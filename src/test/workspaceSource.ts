import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The workspace's own source: `App.tsx` and every hook it is made of.
 *
 * Several gates in this suite read a render condition to check a promise the
 * app makes, because reproducing the condition needs a warning to land
 * mid-test at a watched place. They named `App.tsx`, which was where all of
 * it lived. On 2026-09-09 that file was split along its seams, and the first
 * thing the split did was redden two of those gates on a moved landmark:
 * the gate said the code moved rather than whether the promise still holds,
 * and the quickest way past it is to point it at a file rather than at the
 * thing it is checking.
 *
 * So this reads the workspace as one text, the way `rustSource.ts` reads a
 * native module. Comments come out, because a condition quoted in one has
 * answered for a live one twice in this repository already.
 */
export function workspaceSource(): string {
  const root = join(process.cwd(), "src");
  const hooks = join(root, "hooks");
  const files = [
    join(root, "App.tsx"),
    ...readdirSync(hooks)
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\./.test(name))
      .map((name) => join(hooks, name)),
  ];
  return files
    .map((path) => readFileSync(path, "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\/.*/g, "");
}
