/**
 * Types for the live-contract list, so the TypeScript side can be held to it.
 *
 * The list itself is plain JavaScript because the runner that reads it is a
 * Node script with no build step. The asset-ledger test reads the same list to
 * check that every host the app can reach either has a contract or a written
 * reason it has none, and it cannot do that without knowing the shape.
 */

export interface LiveContract {
  id: string;
  label: string;
  /** The service this contract actually reaches. */
  host: string;
  kind: "native" | "browser";
  /** A cargo test filter, for a native contract. */
  filter?: string;
  /** The test files, for a browser contract. */
  files?: string[];
  /** The name of the live block inside those files. */
  liveBlock?: string;
  /** Whether a release depends on this source answering. */
  required: boolean;
}

export const LIVE_CONTRACTS: LiveContract[];

/** Hosts with no contract, each mapped to the reason it has none. */
export const UNCONTRACTED_HOSTS: Record<string, string>;

export const CONTRACT_TIMEOUT_MS: number;
export const CONTRACT_GAP_MS: number;

export function refuseToRun(env: Record<string, string | undefined>): string | null;
export function classifyRun(options: {
  code: number | null;
  timedOut: boolean;
  ranCount: number;
  missingRunner?: boolean;
}): "pass" | "fail" | "skip";
export function resolveCargo(
  env: Record<string, string | undefined>,
  exists: (candidate: string) => boolean,
  platform?: string,
): string;
export function vitestRanCount(output: string): number;
export function cargoRanCount(output: string): number;
export function exitCodeFor(
  results: Array<{ status: string; required: boolean }>,
): number;
export function summarize(
  results: unknown[],
  startedAt: number,
  finishedAt: number,
): Record<string, unknown>;
