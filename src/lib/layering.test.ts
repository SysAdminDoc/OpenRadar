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
 * Bundler resolution, which is what Vite uses: usually no extension in the
 * source, and a directory means its `index`.
 *
 * A specifier may carry an extension all the same, and the first version of
 * this could not see one. `import { APP_VERSION } from "./settings.js"` in
 * `tileCache.ts` closes the ring this whole file exists to stop; it type-checks
 * under `tsc -b`, it builds under Vite, it ships, and because `settings.js.ts`
 * does not exist the edge was dropped before either rule or the ring finder
 * saw it. One extra candidate and one strip is the difference between a gate
 * and a gate anybody can walk round by writing four characters.
 */
function resolveImport(from: string, where: string): string | null {
  if (!where.startsWith(".")) return null;
  const base = resolve(dirname(from), where);
  const bare = base.replace(/\.(?:[cm]?[jt]sx?)$/, "");
  for (const candidate of [
    base,
    `${bare}.ts`,
    `${bare}.tsx`,
    join(bare, "index.ts"),
    join(bare, "index.tsx"),
  ]) {
    // A file, not a directory: `./overlays` names one and would otherwise
    // answer for itself before its own `index` was tried.
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
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

/**
 * Every import ring in `src/`, each named by its members.
 *
 * Tarjan over the whole tree, because a ring is a property of the graph rather
 * than of any one file: the edge that closes it is usually somewhere else
 * entirely, and reading a single module's imports can never see it.
 *
 * This was scoped to rings holding `settings.ts` when it was written, which
 * meant it computed every one of them and reported one. There was another,
 * three modules wide, sitting there the whole time: the American alerts
 * adapter imports the Canadian and German ones to fold their warnings in, and
 * both of those imported the severity vocabulary back out of it. It worked for
 * the same reason the settings ring did, which is no reason at all.
 */
/** Every module in `src/`, and what each pulls in at runtime. */
function graph(): Map<string, string[]> {
  const edges = new Map<string, string[]>();
  const walk = (from: string) => {
    if (edges.has(from)) return;
    const found: string[] = [];
    edges.set(from, found);
    for (const where of valueImports(readFileSync(from, "utf8"), from)) {
      const landed = resolveImport(from, where);
      if (!landed) continue;
      found.push(landed);
      walk(landed);
    }
  };
  for (const path of filesUnder(ROOT)) walk(path);
  return edges;
}

/**
 * The shortest way from a file up into a layer above it, or null.
 *
 * Followed through the graph rather than read off the file's own imports. The
 * first version of this compared where each import landed against the three
 * directory names, so anything that was not one of them erased the violation:
 * a module at `src/` root importing a hook, imported in turn by something
 * under `lib/`, went straight past. One hop was the whole of the way round it,
 * and no ring forms, so the rule above does not cover for it either.
 */
function reachesUp(
  from: string,
  edges: Map<string, string[]>,
): string[] | null {
  const seen = new Set([from]);
  const queue: string[][] = [[from]];
  while (queue.length) {
    const path = queue.shift()!;
    for (const next of edges.get(path[path.length - 1]) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      const walked = [...path, next];
      if (/^(hooks|panels|components)\//.test(named(next))) return walked;
      queue.push(walked);
    }
  }
  return null;
}

function everyRing(): string[][] {
  const edges = graph();

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const rings: string[][] = [];
  let counter = 0;

  const visit = (at: string) => {
    index.set(at, counter);
    low.set(at, counter);
    counter += 1;
    stack.push(at);
    onStack.add(at);
    for (const next of edges.get(at) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(at, Math.min(low.get(at)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(at, Math.min(low.get(at)!, index.get(next)!));
      }
    }
    if (low.get(at) !== index.get(at)) return;
    const component: string[] = [];
    for (;;) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === at) break;
    }
    // A component of one is a module, not a ring, unless it imports itself.
    const cyclic = component.length > 1 || (edges.get(at) ?? []).includes(at);
    if (cyclic) rings.push(component.map(named).sort());
  };
  for (const node of edges.keys()) if (!index.has(node)) visit(node);
  return rings.sort((left, right) => left[0].localeCompare(right[0]));
}

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

  it("lands a specifier that carries its own extension", () => {
    // Four characters were the whole of the way round this gate. `./x.js` is
    // what the compiler tells you to write under some module settings, it
    // resolves to `x.ts`, it type-checks and it ships, and reading it as a
    // path that does not exist dropped the edge before any rule saw it.
    const from = join(ROOT, "lib", "tileCache.ts");
    const settings = join(ROOT, "lib", "settings.ts");
    expect(resolveImport(from, "./settings")).toBe(settings);
    expect(resolveImport(from, "./settings.js")).toBe(settings);
    expect(resolveImport(from, "./settings.ts")).toBe(settings);

    // A directory still means its own index rather than answering for itself.
    expect(resolveImport(from, "./overlays")).toBe(
      join(ROOT, "lib", "overlays", "index.ts"),
    );
    expect(resolveImport(from, "./overlays/index.js")).toBe(
      join(ROOT, "lib", "overlays", "index.ts"),
    );

    // And something that is not there is still nothing, rather than a path
    // that would quietly join the graph.
    expect(resolveImport(from, "./not-a-module")).toBeNull();
    expect(resolveImport(from, "@tauri-apps/api/core")).toBeNull();
  });

  it("keeps settings underneath the modules that read it", () => {
    // Every file of it, not the name at the front. `settings.ts` became a
    // barrel over `lib/settings/` on 2026-09-09, and a rule that read only
    // the barrel would have gone on passing over a composer that reached
    // straight into an overlay adapter: the file it was reading has three
    // imports in it and none of them is the one this is about.
    const settings = [
      join(ROOT, "lib", "settings.ts"),
      ...filesUnder(join(ROOT, "lib", "settings")),
    ];
    expect(settings.length).toBeGreaterThan(5);
    const reaching: string[] = [];
    for (const path of settings) {
      for (const where of valueImports(readFileSync(path, "utf8"), path)) {
        const landed = resolveImport(path, where);
        if (!landed) continue;
        if (/^lib\/(providers|overlays)\//.test(named(landed))) {
          reaching.push(`${named(path)}: ${where} -> ${named(landed)}`);
        }
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
    const edges = graph();
    const wrong: string[] = [];
    for (const path of libFiles) {
      const walked = reachesUp(path, edges);
      if (walked) wrong.push(walked.map(named).join(" -> "));
    }
    expect(
      wrong,
      "a module under lib/ cannot be read or moved without whatever it " +
        "imports, and these reach up into the layers above it",
    ).toEqual([]);
  });

  it("says how many modules ask the runtime question, and is right about it", () => {
    // `runtime.ts` opens by saying why it is a file of its own, and the reason
    // is a count: enough modules ask this that leaving it in the settings file
    // put an edge back into the module the whole tree sits on. The count said
    // "forty-odd" and the tree held thirty-three, then thirty-five as the
    // snowfall layer and the grid rules asked it too. A number in a comment
    // is only worth writing down if something recounts it, so this does.
    const graphed = graph();
    const asks = [...graphed]
      .filter(
        ([from, to]) =>
          named(from) !== "lib/runtime.ts" &&
          to.some((one) => named(one) === "lib/runtime.ts"),
      )
      .map(([from]) => named(from));
    expect(asks.length).toBe(35);
    expect(readFileSync(join(ROOT, "lib/runtime.ts"), "utf8")).toContain(
      "thirty-five modules ask this question",
    );
  });

  it("closes no import ring anywhere", () => {
    // The two rules above are about single edges, and neither catches a ring
    // that goes round the long way. `settings.ts` reached an overlay adapter
    // directly on 2026-09-04, that edge was taken out, and the same ring was
    // still closed a hop longer through `watch.ts`, which imports the alerts
    // adapter, which imports the tile cache, which imports `settings.ts`.
    // Nothing said so, because nothing was looking at the graph.
    expect(
      everyRing(),
      "these modules import each other in a ring that evaluates at runtime, " +
        "so whether it works depends on the order the bundler picks. Put what " +
        "they share in a leaf of its own, the way spcHazards.ts, runtime.ts " +
        "and alertSeverity.ts are.",
    ).toEqual([]);
  });
});
