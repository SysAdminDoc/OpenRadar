import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The single-site radar's Rust source, every file of it.
 *
 * Several gates in this suite read the native side to check that a constant,
 * a colour ramp or an error code has not drifted from its copy over here.
 * They used to name `level2.rs`. When that file became a directory each of
 * them would have gone on passing while reading nothing, which is the failure
 * mode a source-scanning gate is most prone to and least likely to announce:
 * so this reads the whole directory, and cannot be quietly outrun by the next
 * thing that moves.
 */
export function level2Source(): string {
  const dir = join(process.cwd(), "src-tauri", "src", "level2");
  const files = readdirSync(dir).filter((name) => name.endsWith(".rs"));
  if (files.length === 0) {
    throw new Error("the single-site radar has no source files to read");
  }
  return files.map((name) => readFileSync(join(dir, name), "utf8")).join("\n");
}
