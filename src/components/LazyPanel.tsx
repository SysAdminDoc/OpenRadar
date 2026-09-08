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
      // A panel of its own can be busy too, through `PanelShell`, so the
      // e2e case needs something only this renders. Without it the selector
      // matches the arrived panel and the placeholder could stop existing
      // without anything noticing.
      data-panel-waiting="true"
      // Escape closes it the way it closes the panel that is coming. A chunk
      // that never arrives must not be a box with no way out of it.
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="surface-panel__header">
        <div>
          <p className="eyebrow">{t("panelChunk.loading")}</p>
          <h2>{title}</h2>
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
 * Catches what one panel throws, so the workspace behind it stays up.
 *
 * A class, because there is still no hook that catches a render failure.
 */
class ChunkBoundary extends Component<LazyPanelProps, ChunkBoundaryState> {
  state: ChunkBoundaryState = { failed: false };

  static getDerivedStateFromError(): ChunkBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    // The panel's own name rather than the module's, because the module is a
    // hashed chunk file and the reader's report says which panel they opened.
    log.error(
      "panel",
      `${this.props.title} could not be drawn: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
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
