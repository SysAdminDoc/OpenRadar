/**
 * How serious a warning is, and what that is worth on screen.
 *
 * A leaf with nothing under it, beside `alertTypes.ts`. It lived in the alerts
 * overlay adapter, which is the module that fetches and draws the American
 * feed, and the Canadian and German adapters each imported it back for this
 * vocabulary while the American one imports both of them to fold their
 * warnings in. Those three closed a ring that evaluates at runtime, and it
 * worked only because the rank table is read inside functions rather than
 * while the modules are still being evaluated: a property of the order the
 * bundler happens to choose, not of the code.
 *
 * Eight modules want these four names and none of them wants the fetching.
 */

export type AlertSeverity = "extreme" | "severe" | "moderate" | "minor";

export const SEVERITY_RANK: Record<AlertSeverity, number> = {
  extreme: 3,
  severe: 2,
  moderate: 1,
  minor: 0,
};

export const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  extreme: "#f43f5e",
  severe: "#fb923c",
  moderate: "#facc15",
  minor: "#38bdf8",
};

const EXTREME = [
  "tornado warning",
  "flash flood emergency",
  "extreme wind warning",
  "hurricane warning",
  "tsunami warning",
];

/**
 * The service publishes a CAP significance code (W, A, Y, S). It is blank on a
 * few product types, so the product name is the fallback and life-threatening
 * warnings are lifted above the rest.
 */
export function alertSeverity(prodType: string, sig: string): AlertSeverity {
  const name = prodType.trim().toLowerCase();
  if (EXTREME.includes(name)) return "extreme";

  switch (sig.trim().toUpperCase()) {
    case "W":
      return "severe";
    case "A":
      return "moderate";
    case "Y":
      return "minor";
    default:
      break;
  }

  if (name.endsWith("warning")) return "severe";
  if (name.endsWith("watch")) return "moderate";
  return "minor";
}
