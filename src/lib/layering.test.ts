import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Which module may import which, held against the source rather than promised
 * in a note.
 *
 * Two rules, both of which were already written down in the working notes and
 * both of which had been broken by the time anyone looked.
 *
 * `settings.ts` is underneath everything: the store, the defaults and the
 * normaliser that every other module reads. On 2026-09-04 it grew an import of
 * a constant from an overlay adapter, the adapter imports the tile cache, and
 * the tile cache imports `settings.ts`, so the three of them closed a ring
 * that evaluates at runtime. It worked only because nothing in the ring read a
 * half-initialised module while it was still being evaluated, which is a
 * property of the order the bundler happened to choose. The last time this
 * shape appeared the symptom was a provider's coverage list loading empty,
 * which took Alaska, Hawaii, Guam and Puerto Rico off the radar chain with
 * nothing on screen to say why.
 *
 * And `lib/` is underneath `hooks/`, `panels/` and `components/`. A library
 * that reaches up into the hooks above it cannot be read or moved without
 * them, and one had.
 *
 * The first version of this read the imports with a regular expression, and an
 * adversarial review found five ways past it: a side-effect `import "x"` with
 * no `from` at all, an `await import("x")`, a single-quoted specifier, a
 * second `import` on a line that already had one, and worst of them, the
 * barrel. `import { OVERLAY_ADAPTERS } from "./overlays"` closes the exact
 * ring the paragraph above describes, because the barrel imports the alerts
 * adapter, which imports the tile cache, which imports `settings.ts`, and a
 * rule that matched the spelling `./overlays/` never saw it.
 *
 * So the imports are read with the compiler that is already a dependency, and
 * a specifier is resolved to a file before it is judged. A barrel is followed
 * to what it is rather than matched by how it is spelt.
 */
const ROOT = join(import.meta.dirname ?? __dirname, "..");

/** Every source file the app ships, tests excluded. */
function filesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...filesUnder(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    found.push(path);
  }
  return found;
}

/**
 * Whether an import statement survives to run.
 *
 * `import type { A } from "x"` is erased whole. So is `import { type A }` when
 * every binding is spelt that way and nothing else is bound, which is what the
 * compiler does with no `verbatimModuleSyntax` set: the clause empties and the
 * declaration goes with it. A clause mixing a type binding with a value one
 * keeps the import, and so does a default or a namespace binding beside them.
 */
function erased(clause: ts.ImportClause | ts.NamedExportBindings | undefined) {
  if (!clause) return false;
  if (ts.isImportClause(clause)) {
    if (clause.isTypeOnly) return true;
    if (clause.name) return false;
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return false;
    return bindings.elements.every((element) => element.isTypeOnly);
  }
  if (ts.isNamedExports(clause)) {
    return clause.elements.every((element) => element.isTypeOnly);
  }
  return false;
}

/** Every specifier a file pulls in at runtime, as written. */
function valueImports(source: string, path: string): string[] {
  const parsed = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.ES2022,
    true,
    /\.tsx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const text = (node: ts.Expression | undefined) =>
    node && ts.isStringLiteralLike(node) ? node.text : null;

  const walk = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      // No clause at all is `import "x"`, which is there for its side effects
      // and is the strongest edge of the lot.
      if (!erased(node.importClause)) {
        const where = text(node.moduleSpecifier);
        if (where) found.push(where);
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (!node.isTypeOnly && !erased(node.exportClause)) {
        const where = text(node.moduleSpecifier);
        if (where) found.push(where);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      // A chunk fetched on demand still evaluates the module it names.
      const where = text(node.arguments[0]);
      if (where) found.push(where);
    }
    ts.forEachChild(node, walk);
  };
  walk(parsed);
  return found;
}

/**
 * Where a specifier lands, or null when it leaves the tree.
 *
 * Bundler resolution, which is what Vite uses: no extension in the source, and
 * a directory means its `index`.
 */
function resolveImport(from: string, where: string): string | null {
  if (!where.startsWith(".")) return null;
  const base = resolve(dirname(from), where);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * A file's path from `src/`, forward-slashed whatever the machine writes.
 *
 * `ROOT` is `src/`, so these come back as `lib/settings.ts` with no leading
 * slash. The first rewrite of this test anchored both rules on one, which
 * meant neither could match anything at all: every one of the seven planted
 * imports passed a gate written to catch exactly them.
 */
const named = (path: string) => relative(ROOT, path).replace(/\\/g, "/");

describe("what may import what", () => {
  const libFiles = filesUnder(join(ROOT, "lib"));

  it("has files to look at", () => {
    expect(libFiles.length).toBeGreaterThan(40);
  });

  it("reads an import the way the bundler will", () => {
    // The five shapes the regular expression this replaced could not see, so
    // that a future rewrite has to keep seeing them.
    const seen = valueImports(
      [
        `import "./side-effect";`,
        `const later = await import("./dynamic");`,
        `import { A } from './single-quoted';`,
        `import { B } from "./first"; import { C } from "./second";`,
        `export * from "./re-exported";`,
      ].join("\n"),
      "probe.ts",
    );
    // In the order they are written, which is the order they evaluate.
    expect(seen).toEqual([
      "./side-effect",
      "./dynamic",
      "./single-quoted",
      "./first",
      "./second",
      "./re-exported",
    ]);
  });

  it("leaves out what the compiler erases", () => {
    const seen = valueImports(
      [
        `import type { A } from "./whole-clause";`,
        `import { type B, type C } from "./every-binding";`,
        `export type { D } from "./exported-type";`,
        `import { type E, F } from "./mixed";`,
        `import G, { type H } from "./default-beside-a-type";`,
      ].join("\n"),
      "probe.ts",
    );
    expect(seen).toEqual(["./mixed", "./default-beside-a-type"]);
  });

  it("keeps settings underneath the modules that read it", () => {
    const settings = join(ROOT, "lib", "settings.ts");
    const reaching: string[] = [];
    for (const where of valueImports(
      readFileSync(settings, "utf8"),
      settings,
    )) {
      const landed = resolveImport(settings, where);
      if (!landed) continue;
      if (/^lib\/(providers|overlays)\//.test(named(landed))) {
        reaching.push(`${where} -> ${named(landed)}`);
      }
    }
    expect(
      reaching,
      "settings.ts is imported by these, so importing them back closes a ring " +
        "at runtime. Put what it needs in a leaf module of its own, the way " +
        "spcHazards.ts and satelliteBands.ts are.",
    ).toEqual([]);
  });

  it("keeps the library underneath the hooks and the screen", () => {
    const wrong: string[] = [];
    for (const path of libFiles) {
      for (const where of valueImports(readFileSync(path, "utf8"), path)) {
        const landed = resolveImport(path, where);
        if (!landed) continue;
        if (/^(hooks|panels|components)\//.test(named(landed))) {
          wrong.push(`${named(path)} -> ${named(landed)}`);
        }
      }
    }
    expect(
      wrong,
      "a module under lib/ cannot be read or moved without whatever it " +
        "imports, and these reach up into the layers above it",
    ).toEqual([]);
  });
});
