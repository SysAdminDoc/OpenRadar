/**
 * What the bundle gate actually decides, with the filesystem left outside.
 *
 * `bundle-budget.mjs` was a straight-line program that read `dist/` and
 * exited, which meant nothing had ever watched it fail: a comparison written
 * `>=` where it should be `>` would have passed for ever, and this is the gate
 * that has already caught a chunk over budget once. Split the way `release.mjs`
 * and `release-lib.mjs` are, so the arithmetic can be handed files that are not
 * on the disc.
 *
 * Nothing here reads or writes anything. The caller supplies the names it
 * found and two functions that answer how big a file is, raw and gzipped.
 */

/** Bytes as the kilobytes a budget is written in. */
export function kilobytes(bytes) {
  return Math.round(bytes / 1024);
}

/**
 * Every budgeted chunk measured, and everything wrong with them.
 *
 * A budget names exactly one file. Two matches is a chunk that has split and
 * one is a chunk that has been renamed, and both are a budget that needs
 * writing rather than a measurement to skip: a gate that quietly measures
 * nothing is worse than no gate.
 *
 * `firstLoad: false` keeps a chunk out of the cold-open total. The map's
 * worker is in it, because the map asks for it on the way to its first frame;
 * a panel behind a `lazy` is not.
 */
export function measureChunks({ files, budgets, sizeOf, gzipOf }) {
  const rows = [];
  const failures = [];
  let firstLoadGzip = 0;

  for (const budget of budgets) {
    const found = files.filter((file) => budget.match.test(file));
    if (found.length !== 1) {
      failures.push(
        `${budget.name}: expected exactly one file matching ${budget.match}, found ${found.length}. ` +
          `A renamed or split chunk needs its budget updating rather than skipping.`,
      );
      continue;
    }
    const raw = kilobytes(sizeOf(found[0]));
    const gzip = kilobytes(gzipOf(found[0]));
    rows.push({ name: budget.name, file: found[0], raw, gzip, budget });
    if (budget.firstLoad !== false) firstLoadGzip += gzip;
    if (raw > budget.raw) {
      failures.push(
        `${budget.name} is ${raw} kB, over its ${budget.raw} kB budget.`,
      );
    }
    if (gzip > budget.gzip) {
      failures.push(
        `${budget.name} is ${gzip} kB gzipped, over its ${budget.gzip} kB budget.`,
      );
    }
  }

  return { rows, failures, firstLoadGzip };
}

/**
 * The files the pages name out of `public/`, which Vite copies beside the
 * chunks rather than into them.
 *
 * They were outside every budget and outside the cold-open total: two icons
 * `index.html` declares added twenty-four kilobytes nothing measured. A PNG is
 * already deflated, so it carries a raw budget as well: that is the number
 * that moves when somebody re-exports an icon at a larger size, and gzipping
 * it again buys nothing.
 */
export function measureStatic({ names, read, gzipOf, rawKb, gzipKb }) {
  const failures = [];
  let gzip = 0;
  let rawBytes = 0;
  for (const name of names) {
    let bytes;
    try {
      bytes = read(name);
    } catch {
      failures.push(
        `${name} is declared by a page but is not in the build. A renamed asset ` +
          `needs this list updating rather than dropping.`,
      );
      continue;
    }
    rawBytes += bytes.length;
    gzip += kilobytes(gzipOf(name, bytes));
  }
  const raw = kilobytes(rawBytes);
  if (raw > rawKb) {
    failures.push(
      `the static assets are ${raw} kB, over their ${rawKb} kB budget.`,
    );
  }
  if (gzip > gzipKb) {
    failures.push(
      `the static assets are ${gzip} kB gzipped, over their ${gzipKb} kB budget.`,
    );
  }
  return {
    row: {
      name: "static",
      file: names.join(" "),
      raw,
      gzip,
      budget: { raw: rawKb, gzip: gzipKb },
    },
    failures,
  };
}

/** Whether the cold open is inside its budget, and what to say if it is not. */
export function firstLoadFailure(gzip, budgetKb) {
  return gzip > budgetKb
    ? `the first load is ${gzip} kB gzipped, over its ${budgetKb} kB budget.`
    : null;
}

/** The table the gate prints, as lines, so a test can read it. */
export function budgetTable(rows, firstLoadGzip, firstLoadKb) {
  const width = Math.max(...rows.map((row) => row.name.length), 5);
  const lines = ["chunk".padEnd(width) + "      raw    gzip   budget"];
  for (const row of rows) {
    lines.push(
      [
        row.name.padEnd(width),
        `${String(row.raw).padStart(6)} kB`,
        `${String(row.gzip).padStart(4)} kB`,
        `${String(row.budget.gzip).padStart(5)} kB`,
      ].join(" "),
    );
  }
  lines.push(
    [
      "first load".padEnd(width),
      " ".repeat(9),
      `${String(firstLoadGzip).padStart(4)} kB`,
      `${String(firstLoadKb).padStart(5)} kB`,
    ].join(" "),
  );
  return lines;
}
