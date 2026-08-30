// The HURDAT2 best-track parser, kept apart from the build script so it can be
// tested. See scripts/build-hurdat.mjs for how it is used.

/** Status codes HURDAT2 uses, in the order the app stores them. */
export const STATUSES = [
  "TD",
  "TS",
  "HU",
  "EX",
  "SD",
  "SS",
  "LO",
  "WV",
  "DB",
  "ET",
  "PT",
  "ST",
  "TY",
];

export function coordinate(text) {
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return null;
  const hemisphere = text.trim().slice(-1).toUpperCase();
  return hemisphere === "S" || hemisphere === "W" ? -value : value;
}

export function pointTime(day, time) {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(4, 6));
  const date = Number(day.slice(6, 8));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  return Math.floor(Date.UTC(year, month - 1, date, hour, minute) / 1000);
}

/**
 * Accumulated cyclone energy: the sum of the squared maximum winds at each
 * synoptic hour while the storm is at least a tropical storm, in ten-thousands
 * of knots squared.
 *
 * The synoptic hours are 00, 06, 12, and 18 UTC exactly. HURDAT2 also carries
 * off-hour fixes for landfalls and peak intensities, written at times like
 * 1205 or 1830, and counting one of those as if it were a fifth synoptic
 * observation inflates the total. Ian is the clearest case: it has fixes at
 * both 18:00 and 18:05 on 30 September, and counting both puts its ACE at
 * 17.96 instead of the published 17.47.
 */
export function accumulatedEnergy(points) {
  let total = 0;
  for (const [time, , , wind, status] of points) {
    if (wind < 34) continue;
    if (!["TS", "HU", "SS"].includes(STATUSES[status])) continue;
    const at = new Date(time * 1000);
    if (at.getUTCHours() % 6 !== 0 || at.getUTCMinutes() !== 0) continue;
    total += wind * wind;
  }
  return Math.round((total / 10_000) * 100) / 100;
}

export function parseBasin(text, basin) {
  const storms = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const header = line.split(",").map((part) => part.trim());
    if (header.length < 3 || !/^[A-Z]{2}\d{6}$/.test(header[0])) continue;

    const count = Number(header[2]);
    const points = [];
    for (let step = 1; step <= count; step += 1) {
      const row = (lines[index + step] ?? "").split(",").map((p) => p.trim());
      if (row.length < 7) continue;
      const lat = coordinate(row[4]);
      const lon = coordinate(row[5]);
      const wind = Number(row[6]);
      const status = STATUSES.indexOf(row[3]);
      if (lat === null || lon === null || !Number.isFinite(wind)) continue;
      points.push([
        pointTime(row[0], row[1]),
        Math.round(lat * 10) / 10,
        Math.round(lon * 10) / 10,
        wind < 0 ? 0 : wind,
        status < 0 ? STATUSES.indexOf("LO") : status,
        // HURDAT2 marks a landfall record with an L in the third column, and
        // that is the only place in the file that says where a storm came
        // ashore. Without it the strongest fix is all there is to go on, and
        // for a storm like Ian that is hours out to sea.
        row[2] === "L" ? 1 : 0,
      ]);
    }
    index += count;
    if (!points.length) continue;

    storms.push({
      i: header[0],
      n: header[1] === "UNNAMED" ? "" : header[1],
      y: Number(header[0].slice(4)),
      b: basin,
      a: accumulatedEnergy(points),
      p: points,
    });
  }

  return storms;
}
