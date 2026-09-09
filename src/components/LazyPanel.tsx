import { Component, Suspense, type ReactNode } from "react";
import { X } from "lucide-react";
import { PanelShell } from "./PanelShell";
import { translate, useT } from "../i18n";
import { log } from "../lib/log";

interface LazyPanelProps {
  /**
   * The panel's own title, so the frame names the same thing before the panel
   * exists and after it fails to arrive.
   */
  title: string;
  /**
   * The classes the panel gives its own frame. The placeholder has to carry
   * them or it holds a different amount of room than the panel it stands in
   * for, which is the shift this exists to stop.
   */
  className: string;
  onClose: () => void;
  children: ReactNode;
}

interface ChunkBoundaryState {
  failed: boolean;
  error: unknown;
}

/**
 * A panel that arrives over the network, with somewhere for the failure to go.
 *
 * Ten panels are behind a `lazy`, and a chunk that does not arrive throws the
 * same way a render failure does. Every one of them used to throw past a
 * `Suspense` with a `null` fallback to the boundary in `main.tsx`, which is
 * the whole-window recovery screen: aborting the route panel's chunk took the
 * map, the timeline and the command bar down with it, for a panel the reader
 * may never open. The boundary belongs beside the thing that can fail.
 *
 * The `null` fallback was the second half of it. `data-panel-side` is set when
 * the button is pressed, so the map chrome moves out of the panel's way at
 * once and then waits on the chunk with nothing there: measured at 1,100 ms
 * against 100 ms for a panel that ships in the main bundle. The placeholder
 * holds the room the panel is about to take.
 */
export function LazyPanel({
  title,
  className,
  onClose,
  children,
}: LazyPanelProps) {
  return (
    <ChunkBoundary title={title} className={className} onClose={onClose}>
      <Suspense
        fallback={
          <PanelPlaceholder
            title={title}
            className={className}
            onClose={onClose}
          />
        }
      >
        {children}
      </Suspense>
    </ChunkBoundary>
  );
}

/**
 * The room the panel is about to take, while its chunk is on the way.
 *
 * Deliberately not a `PanelShell`. That one puts the focus on its own heading
 * and remembers whatever was focused when it first rendered, so a placeholder
 * built out of it would take the focus, hand it on, and leave the real panel
 * recording the placeholder's heading as the control to return to when it
 * closes. This holds the box and says it is working, and moves nothing.
 *
 * Escape is not handled here. A first version of this had a keydown on the
 * section, and the section is never focused, so nothing could ever reach it:
 * what actually closes a panel on Escape is the window listener in `App.tsx`,
 * for the placeholder exactly as for the panel. The button is the pointer's
 * way out. One narrow case is left: a reader who tabs onto that button while
 * the chunk loads gives the arriving panel a disconnected opener to return
 * focus to, so Escape lands them on the body rather than on the rail button.
 */
function PanelPlaceholder({
  title,
  className,
  onClose,
}: {
  title: string;
  className: string;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <section
      className={`surface-panel ${className}`}
      aria-busy="true"
      // Announced once, as a status rather than as the panel. A reader using
      // a screen reader pressed a surface button and heard nothing at all
      // until the chunk landed, measured at about 1,100 ms cold: the press
      // took, and the only thing on screen saying so was visual. `status` is
      // polite, so it waits for a gap rather than cutting in, and it carries
      // its own name because the two words inside it are laid out as a panel
      // heading and would otherwise be read as one.
      role="status"
      aria-label={t("panelChunk.loadingPanel", { title })}
      // A panel of its own can be busy too, through `PanelShell`, so the
      // e2e case needs something only this renders. Without it the selector
      // matches the arrived panel and the placeholder could stop existing
      // without anything noticing.
      data-panel-waiting="true"
    >
      <header className="surface-panel__header">
        <div>
          <p className="eyebrow">{t("panelChunk.loading")}</p>
          {/*
            Styled as the panel's heading and deliberately not announced as
            one. The panel this stands in for does not exist yet, so a
            heading here puts a landmark in a reader's outline that vanishes
            under them a second later. It also made the stand-in answer to
            every `getByRole("heading")` in the e2e suite: six cases went on
            to measure an empty box and read a panel that had not arrived,
            and two of those are the ones that watch for a panel hanging out
            of the window.
          */}
          <h2 role="presentation">{title}</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={t("panel.close", { title })}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="surface-panel__body" />
    </section>
  );
}

/**
 * What a chunk that did not arrive throws, as against anything else.
 *
 * Each engine words it differently and none gives it a class of its own, so
 * the message is all there is to read. Being wrong in the generous direction
 * is what matters: a render failure inside a panel that DID arrive must not
 * be described to a reader as a download that did not happen, and must not
 * cost them the fatal screen, which is where the report, the component stack
 * and the way out of a layout the app cannot draw all live.
 */
function isChunkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // The three engines' wordings for a module that did not arrive, and Vite's
  // own for the stylesheet beside it. `__vitePreload` fetches a lazy chunk's
  // CSS before the module and rejects with "Unable to preload CSS for" when
  // that fails, which is the same failure to a reader and matched none of the
  // three: the panel's own frame was skipped and the whole workspace went to
  // the recovery screen. Not reachable while no lazily imported module in
  // this tree carries a stylesheet, and reachable by the first one that does.
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
    error.message,
  );
}

/**
 * Catches a panel whose chunk did not arrive, so the workspace stays up.
 *
 * A class, because there is still no hook that catches a render failure.
 * Anything that is not a failed download is thrown on to the boundary in
 * `main.tsx`, which is the one that can write a report about it.
 */
class ChunkBoundary extends Component<LazyPanelProps, ChunkBoundaryState> {
  state: ChunkBoundaryState = { failed: false, error: null };

  static getDerivedStateFromError(error: unknown): ChunkBoundaryState {
    return { failed: true, error };
  }

  componentDidCatch(
    error: unknown,
    info: { componentStack?: string | null },
  ): void {
    if (!isChunkFailure(error)) return;
    // The panel's own name rather than the module's, because the module is a
    // hashed chunk file and the reader's report says which panel they opened.
    const stack = info.componentStack ? `\n${info.componentStack}` : "";
    log.error(
      "panel",
      `${this.props.title} could not be fetched: ${error instanceof Error ? error.message : String(error)}${stack}`,
    );
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    // Not this boundary's business. A panel that arrived and then threw is a
    // render failure like any other, and the screen that handles those knows
    // how to write a report about it.
    if (!isChunkFailure(this.state.error)) throw this.state.error;
    return (
      <PanelShell
        eyebrow={translate("panelChunk.eyebrow")}
        title={this.props.title}
        className={this.props.className}
        onClose={this.props.onClose}
      >
        <p>{translate("panelChunk.failed")}</p>
        <button type="button" onClick={() => window.location.reload()}>
          {translate("panelChunk.reload")}
        </button>
      </PanelShell>
    );
  }
}
