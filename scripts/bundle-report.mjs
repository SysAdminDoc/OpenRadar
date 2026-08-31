/**
 * What is actually in each built chunk.
 *
 * The budget in `bundle-budget.mjs` says whether the bundle is too big; this
 * says why. It builds once more with a plugin that reads each chunk's own
 * module list, which rolldown already keeps, and adds the bytes up per package
 * so the answer is "maplibre is 60 per cent of it" rather than a list of four
 * hundred files.
 *
 *   node scripts/bundle-report.mjs [chunk-name-fragment]
 */
import { build } from "vite";

const wanted = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "";
const detail = process.argv.includes("--detail");
const byChunk = new Map();

function group(id) {
  const at = id.lastIndexOf("node_modules/");
  if (at < 0) {
    const source = id.split("/src/")[1];
    if (!source) return "other";
    return detail ? `src/${source}` : `src/${source.split("/")[0]}`;
  }
  const rest = id.slice(at + "node_modules/".length).split("/");
  return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
}

await build({
  logLevel: "warn",
  plugins: [
    {
      name: "openradar-bundle-report",
      generateBundle(_options, bundle) {
        for (const [name, chunk] of Object.entries(bundle)) {
          if (chunk.type !== "chunk") continue;
          const packages = new Map();
          for (const [id, info] of Object.entries(chunk.modules ?? {})) {
            const size = info.renderedLength ?? 0;
            if (!size) continue;
            const key = group(id.replaceAll("\\", "/"));
            packages.set(key, (packages.get(key) ?? 0) + size);
          }
          byChunk.set(name, packages);
        }
      },
    },
  ],
});

for (const [name, packages] of byChunk) {
  if (wanted && !name.includes(wanted)) continue;
  const total = [...packages.values()].reduce((sum, size) => sum + size, 0);
  if (total < 20_000) continue;
  console.log(`\n${name}  ${(total / 1024).toFixed(0)} kB of modules`);
  const ranked = [...packages].sort((left, right) => right[1] - left[1]);
  for (const [key, size] of ranked.slice(0, 14)) {
    const share = ((size / total) * 100).toFixed(1).padStart(5);
    console.log(
      `  ${share}%  ${(size / 1024).toFixed(0).padStart(5)} kB  ${key}`,
    );
  }
}
