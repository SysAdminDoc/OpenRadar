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
    const scrollerOf = (element: HTMLElement, axis: "X" | "Y"): HTMLElement => {
      let at = element.parentElement;
      while (at && at !== document.documentElement) {
        const overflow =
          axis === "X"
            ? getComputedStyle(at).overflowX
            : getComputedStyle(at).overflowY;
        // `hidden` counts. It cannot be scrolled at all, so a box squeezed to
        // nothing by one is exactly as unreachable as a box outside a
        // scroller's extent, and walking past it to the document read clean:
        // the same failure this was written to catch, wearing a different
        // overflow value.
        if (
          overflow === "auto" ||
          overflow === "scroll" ||
          overflow === "hidden"
        ) {
          return at;
        }
        at = at.parentElement;
      }
      return document.documentElement;
    };

    /**
     * Where a box sits inside its scroller's own coordinates.
     *
     * The document element is the exception, and it is the one that bites: its
     * bounding rect already moves with the scroll, so its top is minus the
     * scroll offset and subtracting it has ALREADY converted to document
     * coordinates. Adding `scrollTop` on top of that counts the scroll twice
     * and reports everything below the fold as unreachable.
     */
    const within = (
      near: number,
      frame: number,
      scroll: number,
      scroller: HTMLElement,
    ) =>
      scroller === document.documentElement
        ? near - frame
        : near - frame + scroll;
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

      const across = scrollerOf(element, "X");
      const acrossFrame = across.getBoundingClientRect();
      const left = within(
        box.left / scale,
        acrossFrame.left / scale,
        across.scrollLeft,
        across,
      );
      const right = left + box.width / scale;
      // Two pixels of rounding is not a layout fault.
      if (left < -2 || right > across.scrollWidth + 2) {
        out.push(
          `${element.className || element.tagName} ${Math.round(left)}..${Math.round(right)} of ${across.scrollWidth}`,
        );
      }

      // And the same question downwards, which this only ever asked
      // sideways. The tool rail scrolls vertically, and a fixed group above
      // it that grows with the text scale can squeeze the scrolling part to
      // nothing: at 1024 by 720 with the text at 130 percent, twenty
      // controls sat inside a region with a client height of zero. Every
      // horizontal check passed, because horizontally they were fine.
      const down = scrollerOf(element, "Y");
      const downFrame = down.getBoundingClientRect();
      if (down !== document.documentElement && down.clientHeight === 0) {
        out.push(
          `${element.className || element.tagName} is inside ${down.className || down.tagName}, which has no height to show it in`,
        );
        continue;
      }
      const top = within(
        box.top / scale,
        downFrame.top / scale,
        down.scrollTop,
        down,
      );
      const bottom = top + box.height / scale;
      if (top < -2 || bottom > down.scrollHeight + 2) {
        out.push(
          `${element.className || element.tagName} ${Math.round(top)}..${Math.round(bottom)} down, of ${down.scrollHeight}`,
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

/**
 * Anything that is completely covered at the moment it takes the focus.
 *
 * WCAG 2.2's Focus Not Obscured (Minimum). The panels float over the map
 * rather than pushing it aside, and the command bar sits under them, so a
 * reader tabbing along the bar with a panel open is the case where a focus
 * ring can end up behind something. Nothing here objects to a partly covered
 * control: the rule is about a focused thing a sighted keyboard user cannot
 * find at all.
 *
 * Each control is actually focused before it is measured, which is the state
 * the rule is written about. It also settles the false positive the first
 * version had: the command bar scrolls, and a button parked outside its
 * scroller reads as covered right up until the focus brings it back.
 */
export async function obscuredWhenFocused(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const named = (element: Element) =>
      `${element.tagName.toLowerCase()}.${element.className || "?"} ${(
        element.textContent ?? ""
      )
        .trim()
        .slice(0, 24)}`;
    const frame = () =>
      new Promise((settle) => requestAnimationFrame(() => settle(null)));
    const was = document.activeElement;
    const covered: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(
      ".command-bar button, .surface-panel button, .surface-panel select, .surface-panel input, .radar-timeline button",
    )) {
      if (element.hasAttribute("disabled")) continue;
      element.focus();
      if (document.activeElement !== element) continue;
      // The scroll the focus asked for lands on the next frame.
      await frame();
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      let seen = false;
      for (const x of [0.15, 0.5, 0.85]) {
        for (const y of [0.2, 0.5, 0.8]) {
          const at = document.elementFromPoint(
            box.left + box.width * x,
            box.top + box.height * y,
          );
          if (at && (at === element || element.contains(at))) seen = true;
        }
      }
      if (!seen) covered.push(named(element));
    }
    if (was instanceof HTMLElement) was.focus();
    return covered;
  });
}
