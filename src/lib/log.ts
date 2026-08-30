import {
  error as logError,
  info as logInfo,
  warn as logWarn,
} from "@tauri-apps/plugin-log";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  at: number;
  level: LogLevel;
  scope: string;
  message: string;
}

const RECENT_LIMIT = 60;
let recent: LogEntry[] = [];
const listeners = new Set<() => void>();

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function remember(entry: LogEntry) {
  recent = [...recent.slice(-(RECENT_LIMIT - 1)), entry];
  for (const listener of listeners) listener();
}

function write(level: LogLevel, scope: string, message: string) {
  const line = `[${scope}] ${message}`;
  remember({ at: Date.now(), level, scope, message });

  if (!isTauriRuntime()) {
    // Browser previews have no log file, so the console is the only sink.
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
    return;
  }

  const send =
    level === "error" ? logError : level === "warn" ? logWarn : logInfo;
  void send(line).catch(() => {
    console.warn(`The log plugin refused a line: ${line}`);
  });
}

export const log = {
  info: (scope: string, message: string) => write("info", scope, message),
  warn: (scope: string, message: string) => write("warn", scope, message),
  error: (scope: string, message: string) => write("error", scope, message),
};

/** The lines the Diagnostics panel shows, newest last. */
export function recentLog(): LogEntry[] {
  return recent;
}

export function subscribeLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetLog() {
  recent = [];
  for (const listener of listeners) listener();
}
