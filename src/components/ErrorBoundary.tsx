import { Component, type ErrorInfo, type ReactNode } from "react";
import { translate } from "../i18n";
import { diagnosticsBlock } from "../lib/diagnostics";
import { gpuSupport } from "../lib/gpu";
import { knownWebviewVersion } from "../lib/crashReport";
import { recentLog } from "../lib/log";
import {
  isDesktopRuntime,
  readSettings,
  resetLayout,
  saveSettings,
} from "../lib/settings";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: unknown;
  componentStack: string | null;
  copied: "no" | "yes" | "refused";
}

/** The message off whatever was thrown, which is not always an `Error`. */
function messageOf(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message;
  if (typeof thrown === "string") return thrown;
  return String(thrown);
}

/** Its stack, when there is one. `throw "boom"` has none. */
function stackOf(thrown: unknown): string | null {
  return thrown instanceof Error ? (thrown.stack ?? null) : null;
}

/**
 * What a reader sees when the workspace will not draw.
 *
 * The message alone told them something had gone wrong and gave them nothing
 * to do about it but reload into the same crash. Three things are worth
 * having here: the report the tracker asks for, already redacted; the reload;
 * and a way out of an arrangement the app cannot render, which is what a bad
 * camera or a text scale nothing fits at leaves behind.
 *
 * The report is built from what is reachable with the app gone: the log ring
 * buffer, the renderer, the version. It never carries the reader's watched
 * place, because the only way that reaches a report is being passed in, and
 * nothing here has it.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
    componentStack: null,
    copied: "no",
  };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("OpenRadar render failure", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  private report(): string {
    const { error, componentStack } = this.state;
    return diagnosticsBlock({
      renderer: gpuSupport().renderer,
      // Whatever the workspace had read before it stopped. Undefined until
      // somebody has asked, which the report writes as unknown; passing
      // nothing at all made it say "not a native window" on a native window.
      webviewRuntime: knownWebviewVersion(),
      // Neither of them, which is why this screen is on.
      mapReady: false,
      radarReady: false,
      activeSource: null,
      health: [],
      log: recentLog(),
      failure: error
        ? {
            message: messageOf(error),
            // The stack is what a tracker actually needs, and it holds file
            // paths from the build rather than from this machine.
            stack: stackOf(error),
            componentStack,
          }
        : null,
    });
  }

  private copy = () => {
    // Not `void navigator.clipboard.writeText(...).catch(...)`. Reading the
    // property throws on a webview that has no clipboard at all, before any
    // promise exists for a catch to attach to, and React does not catch what
    // an event handler throws: the button on the one screen whose whole job
    // is producing this text did nothing and said nothing.
    void (async () => {
      try {
        await navigator.clipboard.writeText(this.report());
        this.setState({ copied: "yes" });
      } catch {
        // A clipboard can be refused: no permission, no focus, none at all.
        // There are no toasts left on this screen, so the button says it.
        this.setState({ copied: "refused" });
      }
    })();
  };

  private resetLayout = () => {
    void (async () => {
      try {
        // `readSettings`, not `loadSettings`. The latter answers with the
        // defaults when it cannot read, and writing that back would replace
        // the watched places, colour tables, packs and presets this button
        // promises to leave alone.
        const settings = await readSettings();
        await saveSettings(resetLayout(settings));
      } catch {
        // Nothing read means nothing written. The reload is still worth
        // trying, and so is the window below.
      }
      if (isDesktopRuntime()) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("window_reset_geometry");
        } catch {
          // An older build with no such command, or a window that will not
          // move. The reload is the part that matters.
        }
      }
      window.location.reload();
    })();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <div className="fatal-error__mark">!</div>
        <p className="eyebrow">{translate("fatal.eyebrow")}</p>
        <h1>{translate("fatal.title")}</h1>
        <p>{messageOf(this.state.error)}</p>
        <div className="fatal-error__actions">
          <button
            type="button"
            className="fatal-error__quiet"
            onClick={this.copy}
          >
            {translate(
              this.state.copied === "yes"
                ? "fatal.copied"
                : this.state.copied === "refused"
                  ? "fatal.copyRefused"
                  : "fatal.copy",
            )}
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            {translate("fatal.reload")}
          </button>
          <button
            type="button"
            className="fatal-error__quiet"
            onClick={this.resetLayout}
          >
            {translate("fatal.resetLayout")}
          </button>
        </div>
        <p className="fatal-error__note">
          {translate("fatal.resetLayoutNote")}
        </p>
      </main>
    );
  }
}
