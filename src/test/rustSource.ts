import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * One of the native side's modules, every file of it, with the comments out.
 *
 * Several gates in this suite read the native side to check that a constant,
 * a colour ramp or an error code has not drifted from its copy over here.
 * They used to name `level2.rs`. When that file became a directory each of
 * them went red on a missing path, which is a loud way to find out but not a
 * useful one: the gate says the file moved rather than whether the two copies
 * still agree, and the quickest way past it is to point it at a file rather
 * than at the thing it is checking. Reading the whole directory means the
 * next move needs no repair at all, and `mrms.rs` became a directory on
 * 2026-09-09 for the same reason `level2.rs` did.
 *
 * Comments come out here rather than at each caller. The files are joined in
 * name order, so `draw.rs` comes before `listing.rs`, `mod.rs` and `ramp.rs`,
 * and the gates built on this read their constant with a non-global pattern:
 * the first match wins, and a commented-out copy sitting in an earlier file
 * answers for the live one in a later file. Three gates could be defeated
 * that way, and putting the strip at one call site fixed one of the three.
 */
function nativeSource(module: string): string {
  const dir = join(process.cwd(), "src-tauri", "src", module);
  const files = readdirSync(dir).filter((name) => name.endsWith(".rs"));
  if (files.length === 0) {
    throw new Error(`${module} has no source files to read`);
  }
  return files
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "");
}

/** The single-site radar's Rust source. */
export function level2Source(): string {
  return nativeSource("level2");
}

/** The national mosaic's Rust source, its own tests included. */
export function mrmsSource(): string {
  return nativeSource("mrms");
}
