import type { RadarFrame, RadarProvider } from "./providers/types";
import type { OverlayAdapter } from "./overlays/registry";

/**
 * One record saying where a layer came from and what it is claiming.
 *
 * Every layer on the map already knew most of this, and each of them knew it
 * in its own shape: a radar frame carried a provider and a time, an overlay
 * carried an attribution and the moment it was fetched, guidance carried a
 * model name and nothing about the run behind it. So a reader could not ask
 * one question and get one answer, and the answers that did exist could not be
 * compared, serialised, or held to a rule.
 *
 * The point of gathering it here is not tidiness. It is that a picture of the
 * weather is a claim about the world, and the difference between what a radar
 * measured twenty minutes ago and what a model expects in an hour is the whole
 * difference between an observation and a guess. That distinction is worth a
 * type that refuses to let the two be confused.
 */

/**
 * What kind of statement a layer is making.
 *
 * `observation` is something an instrument measured. `forecast` is something a
 * model expects and nobody has seen. `derived` is an observation that has been
 * put through an algorithm, which is still evidence but no longer the reading
 * the instrument produced.
 */
export type ProvenanceKind = "observation" | "forecast" | "derived";

/** Which run of a model produced a forecast, and how far into it this is. */
export interface ModelRun {
  /** When the model was initialised, as an ISO timestamp in UTC. */
  initUtc: string;
  /** How far past the initialisation this frame sits. */
  leadMinutes: number;
}

export interface Provenance {
  /** Stable identity of whatever produced the layer. */
  sourceId: string;
  /** What that source is called on screen. */
  label: string;
  attribution: string;
  attributionUrl?: string;
  kind: ProvenanceKind;
  /**
   * When the atmosphere was measured, in milliseconds.
   *
   * Null on a forecast, because nothing has measured it. That is not a missing
   * field; it is the point.
   */
  observedAt: number | null;
  /** When the statement applies, in milliseconds. */
  validAt: number | null;
  /** When these bytes reached this machine, in milliseconds. */
  fetchedAt: number;
  /**
   * How long the bytes stay fresh, in milliseconds, or null when the source
   * does not say. A source that publishes on a cadence says so; a source that
   * publishes when something happens cannot.
   */
  freshForMs: number | null;
  /**
   * How old the bytes were when the disk cache served them, in seconds, or
   * null when they came off the network. This is what separates a picture that
   * is current from one that survived an outage.
   */
  cachedAgeSeconds: number | null;
  /** The run behind a forecast. */
  modelRun?: ModelRun;
  /**
   * Set on a forecast whose source does not publish the run behind it.
   *
   * The alternative was reporting such a layer as an observation, which is the
   * exact confusion this type exists to refuse: an SPC convective outlook is a
   * statement about tomorrow and calling it something observed at the moment it
   * was fetched is false. Saying "a forecast, and the source does not say which
   * run" is less information and all of it true.
   */
  runUnknown?: boolean;
  /** What was done to the source values, when anything was. */
  derivedFrom?: string;
}

/**
 * Everything wrong with a record, as sentences.
 *
 * This returns the problems rather than throwing, because the interesting use
 * is a test that asserts a whole adapter's output is well formed, and a list
 * of what is wrong is worth more there than the first thing that was.
 */
export function provenanceProblems(record: Provenance): string[] {
  const problems: string[] = [];

  if (!record.sourceId.trim()) problems.push("sourceId is empty.");
  if (!record.label.trim()) problems.push("label is empty.");
  // Attribution is not decoration. Every source here is public data published
  // on terms that ask to be credited, so a record that cannot say who to
  // credit is not one this app is allowed to draw from.
  if (!record.attribution.trim()) problems.push("attribution is empty.");

  if (!Number.isFinite(record.fetchedAt) || record.fetchedAt <= 0) {
    problems.push("fetchedAt is not a moment.");
  }
  // Every other time has to be finite too. A NaN here used to pass every check
  // and then throw out of `provenanceLines`, because `new Date(NaN)` refuses to
  // format, which took the whole diagnostics copy down with it.
  if (record.observedAt !== null && !Number.isFinite(record.observedAt)) {
    problems.push("observedAt is not a moment.");
  }
  if (record.validAt !== null && !Number.isFinite(record.validAt)) {
    problems.push("validAt is not a moment.");
  }
  // A comparison against NaN is false in both directions, so a duration has to
  // be tested for being a number rather than for being out of range.
  if (record.freshForMs !== null && !(record.freshForMs > 0)) {
    problems.push("freshForMs is not a duration.");
  }
  if (record.cachedAgeSeconds !== null && !(record.cachedAgeSeconds >= 0)) {
    problems.push("cachedAgeSeconds is negative.");
  }

  if (record.kind === "observation" || record.kind === "derived") {
    // "An observation" and "a derived", so the sentences read as sentences to
    // whoever finds them in a failing test or a pasted diagnostics block.
    const named =
      record.kind === "observation" ? "An observation" : "A derived";
    if (record.observedAt === null) {
      problems.push(`${named} layer must say when it was observed.`);
    }
    // Valid time is named in the contract for every layer, not only forecasts.
    // For an observation it is normally the moment it was observed, and a
    // record leaving it out cannot answer when the picture applies.
    if (record.validAt === null) {
      problems.push(`${named} layer must say when it is valid.`);
    }
    // The confusion this whole type exists to prevent. A model run on an
    // observation would let a forecast be drawn, labelled and exported as
    // something an instrument saw.
    if (record.modelRun) {
      problems.push(`${named} layer cannot carry a model run.`);
    }
  }

  if (record.kind === "forecast") {
    if (record.validAt === null) {
      problems.push("A forecast must say when it is valid.");
    }
    if (!record.modelRun && !record.runUnknown) {
      problems.push("A forecast must name the run that produced it.");
    }
    if (record.modelRun && record.runUnknown) {
      problems.push("A forecast cannot both name its run and not know it.");
    }
    // The same confusion from the other side. A forecast has not been
    // observed by anything, so a time here would be a measurement that never
    // happened.
    if (record.observedAt !== null) {
      problems.push("A forecast cannot claim an observed time.");
    }
    const init = record.modelRun
      ? Date.parse(record.modelRun.initUtc)
      : Number.NaN;
    if (record.modelRun && !Number.isFinite(init)) {
      problems.push("The model run initialisation is not a time.");
    }
    if (record.modelRun && record.modelRun.leadMinutes < 0) {
      problems.push("A forecast cannot lead backwards from its run.");
    }
    // A forecast valid before the run that produced it is either a decoding
    // error or a relabelled observation, and both are worth refusing.
    if (
      record.validAt !== null &&
      Number.isFinite(init) &&
      record.validAt < init
    ) {
      problems.push("A forecast cannot be valid before its own run.");
    }
  }

  if (record.kind === "derived" && !record.derivedFrom?.trim()) {
    problems.push("A derived layer must say what was done to it.");
  }

  return problems;
}

/** Whether a record is well formed, for callers that only need the answer. */
export function provenanceValid(record: Provenance): boolean {
  return provenanceProblems(record).length === 0;
}

/**
 * Whether the bytes have outlived the freshness their source promised.
 *
 * A source that does not publish a cadence cannot be stale by this measure,
 * which is why the answer is false rather than a guess.
 */
export function provenanceStale(record: Provenance, now: number): boolean {
  if (record.freshForMs === null) return false;
  return now - record.fetchedAt > record.freshForMs;
}

/**
 * A radar frame's record.
 *
 * The frame already knows whether it has happened: a forecast stamp is present
 * only on frames that have not. That one field decides the kind, the observed
 * time, and the model run together, so the three cannot drift apart.
 */
export function radarProvenance(options: {
  frame: RadarFrame;
  provider: RadarProvider | null;
  fetchedAt: number;
  cachedAgeSeconds?: number | null;
  freshForMs?: number | null;
}): Provenance {
  const { frame, fetchedAt } = options;
  // The provider on screen is not always the provider that made this frame.
  // The forecast tail comes from HRRR and an archive replay comes from the
  // stored frames, while the timeline's own source stays whichever live
  // provider is serving the mosaic. Taking the label and the link from a
  // provider that did not produce the frame is how a record ends up reading
  // "MRMS (hrrr)" and crediting the wrong service for the picture.
  const provider =
    options.provider?.id === frame.providerId ? options.provider : null;
  // Frame times are seconds, because that is what the services publish. Every
  // other time in this record is milliseconds, so the conversion belongs here
  // rather than at each of the call sites that would otherwise have to
  // remember it.
  const at = frame.time * 1000;
  const forecast = frame.forecast;
  return {
    sourceId: frame.providerId,
    label: provider?.label ?? frame.providerId,
    attribution: frame.attribution || (provider?.attribution ?? ""),
    attributionUrl: provider?.attributionUrl,
    kind: forecast ? "forecast" : "observation",
    observedAt: forecast ? null : at,
    validAt: at,
    fetchedAt,
    freshForMs: options.freshForMs ?? null,
    cachedAgeSeconds: options.cachedAgeSeconds ?? null,
    modelRun: forecast
      ? { initUtc: forecast.initUtc, leadMinutes: forecast.leadMinutes }
      : undefined,
  };
}

/**
 * An overlay's record.
 *
 * An overlay publishes on a cadence and the adapter already declares it, so
 * this is the one place where the freshness rule comes from the source rather
 * than from a caller's guess.
 */
export function overlayProvenance(options: {
  adapter: OverlayAdapter;
  fetchedAt: number;
  observedAt?: number | null;
  cachedAgeSeconds?: number | null;
  /**
   * What kind of statement the adapter's layer makes, where the caller knows.
   *
   * Not every overlay is an observation. Three of them are forecasts: the SPC
   * outlooks and discussions are about the day ahead, and a tropical cone is a
   * track nobody has watched yet. Defaulting all of them to an observation
   * reported a forecast as something measured, which is the one mistake this
   * whole contract is for.
   */
  kind?: ProvenanceKind;
}): Provenance {
  const { adapter, fetchedAt } = options;
  // An overlay is a snapshot of what the service was publishing when it was
  // asked, and most of these services do not date their own contents. The
  // moment it was fetched is then the only honest answer to when it was true.
  const observedAt = options.observedAt ?? fetchedAt;
  const kind = options.kind ?? "observation";
  const forecast = kind === "forecast";
  return {
    sourceId: adapter.id,
    label: adapter.label,
    attribution: adapter.attribution,
    attributionUrl: adapter.attributionUrl,
    kind,
    observedAt: forecast ? null : observedAt,
    validAt: observedAt,
    fetchedAt,
    freshForMs: adapter.refreshMs,
    cachedAgeSeconds: options.cachedAgeSeconds ?? null,
    // These services publish when they publish and do not date the run behind
    // what they say, so the record says the run is unknown rather than none.
    runUnknown: forecast ? true : undefined,
  };
}

/**
 * A record's times as ISO strings, for anything that writes text.
 *
 * A time that is not a time is written as such rather than thrown over. This
 * is reached from the diagnostics block, which exists to be pasted into a
 * report about something already going wrong, and a formatter that throws
 * there loses the whole report to protect a single field.
 */
function stamp(at: number | null): string {
  if (at === null) return "none";
  if (!Number.isFinite(at)) return "unreadable";
  try {
    return new Date(at).toISOString();
  } catch {
    // Finite but outside the range a Date can hold.
    return "unreadable";
  }
}

/**
 * One record as plain lines, for the places that have to write it down.
 *
 * Diagnostics pastes this into a bug report and the export burns a shortened
 * form of it into the corner of a picture, so the wording has to survive being
 * read by somebody who does not have the app in front of them.
 */
export function provenanceLines(record: Provenance, now?: number): string[] {
  const lines = [
    `${record.label} (${record.sourceId}) · ${record.kind}`,
    `  observed ${stamp(record.observedAt)} · valid ${stamp(record.validAt)}`,
    `  fetched ${stamp(record.fetchedAt)}`,
  ];
  if (record.modelRun) {
    lines.push(
      `  run ${record.modelRun.initUtc} +${record.modelRun.leadMinutes} min`,
    );
  } else if (record.runUnknown) {
    lines.push("  run not published by the source");
  }
  if (record.derivedFrom) lines.push(`  derived ${record.derivedFrom}`);
  lines.push(
    record.cachedAgeSeconds === null
      ? "  cache live"
      : `  cache ${Math.round(record.cachedAgeSeconds)}s old`,
  );
  if (now !== undefined && provenanceStale(record, now)) {
    lines.push("  stale past its refresh");
  }
  lines.push(`  credit ${attributionText(record.attribution)}`);
  return lines;
}

/**
 * One record as it is written into a file that leaves the app.
 *
 * The in-memory record keeps its times as milliseconds because that is what
 * every caller compares and subtracts. A file that outlives the app has a
 * different reader: a person opening it next year, or a tool that never had
 * this type. So the times are written as ISO strings, which say their own
 * units and their own zone, and the numeric forms are not repeated beside
 * them. Two spellings of one time is two things that can disagree.
 */
export interface ProvenanceRecordDocument {
  sourceId: string;
  label: string;
  attribution: string;
  attributionUrl?: string;
  kind: ProvenanceKind;
  /** When the atmosphere was measured. Null on a forecast. */
  observed: string | null;
  /** When the statement applies. */
  valid: string | null;
  /** When the bytes reached the machine that drew this. */
  fetched: string;
  freshForMs: number | null;
  cachedAgeSeconds: number | null;
  modelRun?: ModelRun;
  runUnknown?: boolean;
  derivedFrom?: string;
}

/**
 * Everything an exported picture can say about where it came from.
 *
 * A caption has room for a time and a credit. That is enough to know what you
 * are looking at and not enough to check it: which run of which model, whether
 * the bytes came off a disk cache during an outage, what the source calls
 * itself. This is that, beside the file, in a shape that does not need the app
 * to read.
 */
export interface ProvenanceDocument {
  format: "openradar-provenance";
  formatVersion: 1;
  /** The application and version that wrote the picture. */
  application: string;
  writtenAt: string;
  /** The file this describes, by name. */
  picture: string;
  /** Credit for the map under the weather. */
  basemap: string;
  /**
   * One entry per frame that reached the file, by its index on the timeline.
   *
   * A loop is not one source. Its observed frames and its forecast tail come
   * from different services, and a GIF holds only the last of them, so a
   * single record for the whole file would be wrong for most of it.
   */
  frames: Array<ProvenanceRecordDocument & { index: number }>;
}

/**
 * An attribution as words rather than markup.
 *
 * Every provider states its credit as an HTML anchor, because that is what
 * MapLibre's attribution control renders and the control was the first place
 * these strings were needed. Anywhere else they are wrong: a caption burned
 * into a picture would draw the tag itself, and a record written into a file
 * would carry a link nobody can click.
 */
export function attributionText(attribution: string): string {
  return attribution
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp|copy);/g, (_, name: string) => {
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        "#39": "'",
        nbsp: " ",
        copy: "©",
      };
      return named[name] ?? "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The link inside an attribution, for a record that has no separate one.
 *
 * The provider registry keeps the URL apart from the credit, but a frame that
 * no provider made carries only the anchor, and throwing the href away while
 * writing a provenance file is the one place that loss would matter.
 */
function attributionHref(attribution: string): string | undefined {
  const found = /href="([^"]+)"/.exec(attribution);
  return found?.[1];
}

/** The same as `stamp`, but a time that is absent stays absent in a file. */
function stampOrNull(at: number | null): string | null {
  return at === null ? null : stamp(at);
}

/** A record in the form that goes into a file. */
export function provenanceRecordDocument(
  record: Provenance,
): ProvenanceRecordDocument {
  return {
    sourceId: record.sourceId,
    label: record.label,
    attribution: attributionText(record.attribution),
    attributionUrl:
      record.attributionUrl ?? attributionHref(record.attribution),
    kind: record.kind,
    observed: stampOrNull(record.observedAt),
    valid: stampOrNull(record.validAt),
    fetched: stamp(record.fetchedAt),
    freshForMs: record.freshForMs,
    cachedAgeSeconds: record.cachedAgeSeconds,
    modelRun: record.modelRun,
    runUnknown: record.runUnknown,
    derivedFrom: record.derivedFrom,
  };
}

/** The sidecar for one exported picture. */
export function provenanceDocument(options: {
  picture: string;
  application: string;
  basemap: string;
  writtenAt: number;
  frames: Array<{ index: number; record: Provenance }>;
}): ProvenanceDocument {
  return {
    format: "openradar-provenance",
    formatVersion: 1,
    application: options.application,
    writtenAt: stamp(options.writtenAt),
    picture: options.picture,
    basemap: options.basemap,
    frames: options.frames
      // The encoder asks for whichever frames it is writing, in whatever order
      // suits it. The file reads in timeline order.
      .slice()
      .sort((left, right) => left.index - right.index)
      .map(({ index, record }) => ({
        index,
        ...provenanceRecordDocument(record),
      })),
  };
}

/**
 * The credit burned into the corner of a picture.
 *
 * This used to be a constant naming NOAA, which was right for a live American
 * mosaic and wrong for everything else the app can draw: a German or Canadian
 * provider, a 2005 hurricane replayed out of the Iowa State archive. A picture
 * that leaves the app carries its credit to people who cannot check it, so the
 * credit has to come from the same record every other surface reads.
 */
export function provenanceCredit(
  basemap: string,
  record: Provenance | null,
): string {
  const source = record ? attributionText(record.attribution) : "";
  return ["OpenRadar", basemap, source]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" · ");
}

/**
 * The record for whichever frame the timeline is showing.
 *
 * The diagnostics block and the export both need this and both used to work
 * it out for themselves, which is how they came to disagree: diagnostics
 * carried the cache age and the freshness the loop publishes on, and the
 * export quietly wrote null for both and stamped the moment of the question
 * as the moment the bytes arrived. So every exported record said the picture
 * came off the network just now, including one exported offline from a disk
 * cache during an outage, which is the exact case the fields exist for.
 *
 * One function, so the next surface that needs a radar record gets the same
 * answer as the two that already have one.
 */
export function timelineProvenance(options: {
  frames: RadarFrame[];
  frameIndex: number;
  provider: RadarProvider | null;
  /** When the frames reached this machine. */
  fetchedAt: number;
  cachedAgeSeconds: number | null;
}): Provenance | null {
  const frame = options.frames[options.frameIndex];
  if (!frame) return null;
  // How long a loop stays fresh is the gap between its own frames, which is
  // what the provider publishes on. Two frames are needed to know it, and a
  // single-frame loop simply does not say.
  const step =
    options.frames.length > 1
      ? (options.frames[1].time - options.frames[0].time) * 1000
      : null;
  return radarProvenance({
    frame,
    provider: options.provider,
    fetchedAt: options.fetchedAt,
    cachedAgeSeconds: options.cachedAgeSeconds,
    freshForMs: step && step > 0 ? step * 2 : null,
  });
}
