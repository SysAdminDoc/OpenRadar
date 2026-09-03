import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * The accessibility scan, shared so a state can be scanned where it is built.
 *
 * The gate used to live entirely in one spec, which meant it could only scan
 * states that spec knew how to reach: the toast, the map popup, the catch-up
 * and curiosity cards, the first-run reveal, an incident pack and the record
 * with rows all have fixtures already, in the specs that are about them, and
 * duplicating those fixtures to scan them would have left two copies to drift
 * apart. `expectClean` goes in the spec that already has the state on screen.
 */

/**
 * The map canvas is a WebGL surface with no accessible content of its own, and
 * MapLibre's own attribution control is outside our markup.
 */
const EXCLUDED = [".maplibregl-canvas-container", ".maplibregl-ctrl-attrib"];

/** Panels animate in, and axe reads a mid-animation colour as a failure. */
export const PANEL_SETTLE_MS = 300;

export async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude(EXCLUDED)
    .analyze();

  return results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
}

export function describeViolations(
  violations: Awaited<ReturnType<typeof scan>>,
): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.nodes
          .map((node) => node.target.join(" "))
          .join(", ")}`,
    )
    .join("\n");
}

/**
 * Scans whatever is on screen and names the state in the failure.
 *
 * The label is there because a bare "" on the left of an equality is the
 * least useful failure a suite can print.
 */
export async function expectClean(page: Page, label: string) {
  expect(`${label}: ${describeViolations(await scan(page))}`).toBe(
    `${label}: `,
  );
}
