interface LiveRegionProps {
  /** Something worth knowing that can wait for a pause. */
  polite: string;
  /**
   * A warning at a watched place, which cannot, and the count of how many
   * have been made. The count is never rendered: it is what makes a second
   * warning that reads identically to the first a change the reader hears.
   */
  assertive: { said: number; text: string };
}

/**
 * The two regions a screen reader watches.
 *
 * Mounted for the life of the workspace and empty most of the time, because a
 * live region that arrives in the document already holding its text is often
 * not read at all: the reader notices changes to a region it was already
 * watching, not the appearance of a new one. Every announcement in the app
 * writes into one of these rather than mounting its own.
 *
 * The roles carry the politeness, with the attributes written out beside them
 * for the readers that only look at one or the other. Neither region is
 * named: axe rejects a name on a plain container, and a named status region
 * is read out with its own title every time it changes.
 *
 * Assertive is reserved for a warning at a place the reader is watching. It
 * interrupts whatever is being read, which is right exactly once and wrong
 * every other time.
 */
export function LiveRegion({ polite, assertive }: LiveRegionProps) {
  return (
    <div className="live-region">
      <div role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {/* Keyed, so an identical sentence is a new node rather than an
            unchanged one a screen reader has no reason to read again. */}
        <span key={assertive.said}>{assertive.text}</span>
      </div>
    </div>
  );
}
