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
    if (!record.modelRun) {
      problems.push("A forecast must name the run that produced it.");
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
}): Provenance {
  const { adapter, fetchedAt } = options;
  // An overlay is a snapshot of what the service was publishing when it was
  // asked, and most of these services do not date their own contents. The
  // moment it was fetched is then the only honest answer to when it was true.
  const observedAt = options.observedAt ?? fetchedAt;
  return {
    sourceId: adapter.id,
    label: adapter.label,
    attribution: adapter.attribution,
    attributionUrl: adapter.attributionUrl,
    kind: "observation",
    observedAt,
    validAt: observedAt,
    fetchedAt,
    freshForMs: adapter.refreshMs,
    cachedAgeSeconds: options.cachedAgeSeconds ?? null,
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
  lines.push(`  credit ${record.attribution}`);
  return lines;
}
