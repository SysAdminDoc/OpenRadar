import type { Page } from "@playwright/test";

/**
 * Two questions about a layout that a screenshot cannot answer on its own:
 * whether anything has been pushed somewhere a reader can never scroll to,
 * and whether anything is being cut off where it sits.
 *
 * Shared, because the answers matter at every width the app is used at: the
 * narrow window where the bar collapses, the ordinary one, the wide desktop,
 * and any of those in a language whose words are a third longer.
 */

/**
 * Anything that cannot be brought into view, whatever is scrolled.
 *
 * Position alone says nothing: the command bar scrolls on purpose, so a button
 * sitting at a negative coordinate may simply be scrolled past. What matters
 * is whether it lies inside the scrollable extent of whatever holds it. A
 * button before the start of that extent can never be reached.
 */
export async function unreachable(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const scrollerOf = (element: HTMLElement): HTMLElement => {
      let at = element.parentElement;
      while (at && at !== document.documentElement) {
        const overflow = getComputedStyle(at).overflowX;
        if (overflow === "auto" || overflow === "scroll") return at;
        at = at.parentElement;
      }
      return document.documentElement;
    };
    // A bounding box comes back in drawn pixels and scrollWidth in layout
    // pixels, and zoom is the difference between them. Comparing the two
    // without dividing makes everything look 30 percent too far right.
    const scale =
      Number(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--text-scale",
        ),
      ) || 1;
    const out: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(
      ".command-bar button, .radar-timeline, .top-status, .tool-hud, .surface-panel",
    )) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const scroller = scrollerOf(element);
      const frame = scroller.getBoundingClientRect();
      const left = (box.left - frame.left) / scale + scroller.scrollLeft;
      const right = left + box.width / scale;
      // Two pixels of rounding is not a layout fault.
      if (left < -2 || right > scroller.scrollWidth + 2) {
        out.push(
          `${element.className || element.tagName} ${Math.round(left)}..${Math.round(right)} of ${scroller.scrollWidth}`,
        );
      }
    }
    return out;
  });
}

export async function clipped(page: Page) {
  return page.evaluate(() => {
    const scrolls = (element: Element) => {
      const style = getComputedStyle(element);
      return (
        style.overflowX === "auto" ||
        style.overflowX === "scroll" ||
        style.overflowY === "auto" ||
        style.overflowY === "scroll"
      );
    };
    const bad: string[] = [];
    const scope = [
      ".surface-panel",
      ".command-bar",
      ".radar-timeline",
      ".radar-legend",
      ".product-legends",
      ".satellite-chip",
      ".pane-compare",
      ".tool-hud",
      ".toast",
      ".zoom-controls",
    ].join(", ");
    for (const root of document.querySelectorAll<HTMLElement>(scope)) {
      for (const element of [
        root,
        ...root.querySelectorAll<HTMLElement>("*"),
      ]) {
        // A box that is meant to scroll is doing its job, and so is anything
        // inside one: the point of a scroller is that its contents are allowed
        // to be bigger than it is.
        if (scrolls(element)) continue;
        let inScroller = false;
        for (
          let parent = element.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          if (scrolls(parent)) {
            inScroller = true;
            break;
          }
        }
        if (inScroller) continue;
        if (element.tagName === "CANVAS" || element.tagName === "INPUT") {
          continue;
        }
        // The one caption allowed to end in an ellipsis. It sits under an
        // icon in a bar of fixed height, and the whole label is on the
        // button's tooltip and its accessible name, so nothing is lost by
        // shortening what is drawn. The bar itself scrolls, so no button
        // becomes unreachable however long the words get.
        if (element.closest(".command-button")) continue;
        if (!element.textContent?.trim()) continue;
        const wide = element.scrollWidth > element.clientWidth + 1;
        const tall = element.scrollHeight > element.clientHeight + 1;
        if (!wide && !tall) continue;
        bad.push(
          `${element.className || element.tagName} ${wide ? "wide" : "tall"}: ${element.textContent
            .trim()
            .slice(0, 40)}`,
        );
      }
    }
    return bad;
  });
}
