import type { ProviderId } from "./types";

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
  announce();
}
