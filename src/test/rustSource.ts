import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The single-site radar's Rust source, every file of it.
 *
 * Several gates in this suite read the native side to check that a constant,
 * a colour ramp or an error code has not drifted from its copy over here.
 * They used to name `level2.rs`. When that file became a directory each of
 * them went red on a missing path, which is a loud way to find out but not a
 * useful one: the gate says the file moved rather than whether the two copies
 * still agree, and the quickest way past it is to point it at a file rather
 * than at the thing it is checking. This reads the whole directory, so the
 * next move needs no repair at all.
 */
export function level2Source(): string {
  const dir = join(process.cwd(), "src-tauri", "src", "level2");
  const files = readdirSync(dir).filter((name) => name.endsWith(".rs"));
  if (files.length === 0) {
    throw new Error("the single-site radar has no source files to read");
  }
  return files.map((name) => readFileSync(join(dir, name), "utf8")).join("\n");
}
