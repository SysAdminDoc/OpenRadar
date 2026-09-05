import type { ProviderId } from "./types";

/**
 * One moment a source changed its mind about whether it was working.
 *
 * Transitions rather than polls: a source that has been failing for an hour
 * is one incident and not two hundred, and what a reader sending a report
 * needs is when it started and what it said.
 */
export interface ProviderIncident {
  id: ProviderId;
  at: number;
  ok: boolean;
  /** What the service or the network said, for a failure. Null for a repair. */
  reason: string | null;
}

/**
 * How many are kept.
 *
 * Enough to cover a bad afternoon across every source and small enough that
 * the whole ring is a paragraph in a report. Oldest out first.
 */
export const MAX_INCIDENTS = 50;

const INCIDENTS_KEY = "openradar.incidents";

let incidents: ProviderIncident[] = [];

export interface ProviderHealth {
  id: ProviderId;
  lastSuccess: number | null;
  lastFailure: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  frameCount: number;
}

type Listener = () => void;

const health = new Map<ProviderId, ProviderHealth>();
const listeners = new Set<Listener>();

function entry(id: ProviderId): ProviderHealth {
  const existing = health.get(id);
  if (existing) return existing;
  const created: ProviderHealth = {
    id,
    lastSuccess: null,
    lastFailure: null,
    lastError: null,
    consecutiveFailures: 0,
    frameCount: 0,
  };
  health.set(id, created);
  return created;
}

let snapshot: ProviderHealth[] = [];

function announce() {
  snapshot = [...health.values()].map((record) => ({ ...record }));
  for (const listener of listeners) listener();
}

/**
 * Reads the ring back, or starts an empty one.
 *
 * Anything the file cannot be read as is dropped rather than repaired: this
 * is a record of what went wrong, and a half-parsed one is not worth keeping
 * a reader's next report honest with.
 */
function loadIncidents(): ProviderIncident[] {
  try {
    const held: unknown = JSON.parse(
      window.localStorage.getItem(INCIDENTS_KEY) ?? "[]",
    );
    if (!Array.isArray(held)) return [];
    return held
      .filter(
        (one): one is ProviderIncident =>
          Boolean(one) &&
          typeof one === "object" &&
          typeof (one as ProviderIncident).id === "string" &&
          Number.isFinite((one as ProviderIncident).at) &&
          typeof (one as ProviderIncident).ok === "boolean",
      )
      .slice(-MAX_INCIDENTS);
  } catch {
    return [];
  }
}

function saveIncidents() {
  try {
    window.localStorage.setItem(INCIDENTS_KEY, JSON.stringify(incidents));
  } catch {
    // A full or refused store costs the history and nothing else. The app
    // does not stop drawing weather because it could not write a note about
    // a service that failed an hour ago.
  }
}

/**
 * Remembers a change of state, and nothing else.
 *
 * The first thing a source ever says counts as a change: a source that fails
 * on its first request has an incident, and one that works has the moment it
 * started working, which is the other half of reading an outage.
 */
function remember(record: ProviderHealth, ok: boolean, reason: string | null) {
  let was: ProviderIncident | undefined;
  for (const one of incidents) {
    if (one.id === record.id) was = one;
  }
  if (was && was.ok === ok) return;
  incidents = [
    ...incidents,
    {
      id: record.id,
      at: record.lastSuccess ?? record.lastFailure ?? 0,
      ok,
      reason,
    },
  ].slice(-MAX_INCIDENTS);
  saveIncidents();
}

/** Every incident kept, oldest first. */
export function providerIncidents(): ProviderIncident[] {
  return incidents;
}

/** Forgets them, which is the reader's to do. */
export function clearIncidents() {
  incidents = [];
  saveIncidents();
  announce();
}

/** Reads the ring off the disk. Called once, where the workspace starts. */
export function loadProviderIncidents() {
  incidents = loadIncidents();
}

export function recordSuccess(
  id: ProviderId,
  frameCount: number,
  now = Date.now(),
) {
  const record = entry(id);
  record.lastSuccess = now;
  record.lastError = null;
  record.consecutiveFailures = 0;
  record.frameCount = frameCount;
  remember(record, true, null);
  announce();
}

export function recordFailure(
  id: ProviderId,
  message: string,
  now = Date.now(),
) {
  const record = entry(id);
  record.lastFailure = now;
  record.lastError = message;
  record.consecutiveFailures += 1;
  remember(record, false, message);
  announce();
}

/** A stable snapshot so React can subscribe without re-rendering on every read. */
export function providerHealth(): ProviderHealth[] {
  return snapshot;
}

export function subscribeHealth(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetHealth() {
  health.clear();
  incidents = [];
  announce();
}
