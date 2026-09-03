import { Component, type ErrorInfo, type ReactNode } from "react";
import { translate } from "../i18n";
import { diagnosticsBlock } from "../lib/diagnostics";
import { gpuSupport } from "../lib/gpu";
import { recentLog } from "../lib/log";
import { loadSettings, resetLayout, saveSettings } from "../lib/settings";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
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
    copied: false,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
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
      // Neither of them, which is why this screen is on.
      mapReady: false,
      radarReady: false,
      activeSource: null,
      health: [],
      log: recentLog(),
      failure: error
        ? {
            message: error.message,
            // The stack is what a tracker actually needs, and it holds file
            // paths from the build rather than from this machine.
            stack: error.stack ?? null,
            componentStack,
          }
        : null,
    });
  }

  private copy = () => {
    void navigator.clipboard
      .writeText(this.report())
      .then(() => this.setState({ copied: true }))
      .catch(() => {
        // A refused clipboard is not worth a second failure screen.
      });
  };

  private resetLayout = () => {
    void loadSettings()
      .then((settings) => saveSettings(resetLayout(settings)))
      .catch(() => {
        // Nothing to put back. Reloading is still worth trying.
      })
      .finally(() => window.location.reload());
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <div className="fatal-error__mark">!</div>
        <p className="eyebrow">{translate("fatal.eyebrow")}</p>
        <h1>{translate("fatal.title")}</h1>
        <p>{this.state.error.message}</p>
        <div className="fatal-error__actions">
          <button
            type="button"
            className="fatal-error__quiet"
            onClick={this.copy}
          >
            {this.state.copied
              ? translate("fatal.copied")
              : translate("fatal.copy")}
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
