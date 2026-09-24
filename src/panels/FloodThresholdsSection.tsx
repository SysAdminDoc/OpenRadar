import { useState } from "react";
import { useT, type StringKey } from "../i18n";
import {
  DEFAULT_FLOOD_THRESHOLDS,
  FLOOD_PANELS,
  FLOOD_TIERS,
  normalizeFloodThresholds,
  TIER_KEYS,
  type FloodPanel,
  type FloodThresholds,
} from "../lib/flashFlood";

/** Each panel's name, and the unit its bars are written in. */
const PANEL_KEYS: Record<FloodPanel, { label: StringKey; unit: StringKey }> = {
  qpe: { label: "flood.panelQpe", unit: "flood.unitQpe" },
  ari: { label: "flood.panelAri", unit: "flood.unitAri" },
  ratio: { label: "flood.panelRatio", unit: "flood.unitRatio" },
  streamflow: { label: "flood.panelStreamflow", unit: "flood.unitStreamflow" },
};

/**
 * The sixteen bars the flash flood call is read against.
 *
 * In the paper's own units, whatever units the reader has chosen elsewhere,
 * because the bars are the paper's and a regional study that moves them will
 * publish them in those units too.
 *
 * Taken when the reader leaves a box rather than on every keystroke. The bars
 * have to climb, and typing 200 into a box that holds 125 passes through 2 on
 * the way: refused as it was typed, the box snapped back to 125 and the
 * number could never be entered at all. A finished entry that would stop a
 * panel climbing is put back and the reason given.
 */
export function FloodThresholdsSection({
  thresholds,
  onThresholds,
}: {
  thresholds: FloodThresholds;
  onThresholds: (next: FloodThresholds) => void;
}) {
  const t = useT();
  const [refused, setRefused] = useState(false);
  const changed = FLOOD_PANELS.some((panel) =>
    thresholds[panel].some(
      (bar, at) => bar !== DEFAULT_FLOOD_THRESHOLDS[panel][at],
    ),
  );
  /** Whether an entry was taken. */
  const take = (panel: FloodPanel, at: number, value: number): boolean => {
    if (!Number.isFinite(value)) return false;
    const bars = [...thresholds[panel]] as FloodThresholds[FloodPanel];
    bars[at] = value;
    const next = normalizeFloodThresholds({ ...thresholds, [panel]: bars });
    // A panel the settings reader put back as the paper's was one whose bars
    // stopped climbing. Replacing three numbers the reader was not touching
    // would be a strange answer to one they were, so nothing is taken.
    if (next[panel][at] !== value) return false;
    onThresholds(next);
    return true;
  };

  return (
    <div className="settings-section" data-flood-thresholds>
      <div className="settings-section__title">
        <span>{t("flood.thresholds")}</span>
        <small>{t("flood.thresholdsDetail")}</small>
      </div>
      <table className="flood-thresholds">
        <thead>
          <tr>
            <th scope="col">{t("flood.panel")}</th>
            {FLOOD_TIERS.map((tier) => (
              <th scope="col" key={tier}>
                {t(TIER_KEYS[tier])}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FLOOD_PANELS.map((panel) => (
            <tr key={panel} data-flood-panel={panel}>
              <th scope="row">
                {t(PANEL_KEYS[panel].label)}
                <small>{t(PANEL_KEYS[panel].unit)}</small>
              </th>
              {FLOOD_TIERS.map((tier, at) => (
                <td key={tier}>
                  <input
                    // Keyed on the value held, so a reset or an entry taken
                    // elsewhere puts the new number in the box.
                    key={`${panel}-${at}-${thresholds[panel][at]}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    defaultValue={thresholds[panel][at]}
                    aria-label={t("flood.barLabel", {
                      panel: t(PANEL_KEYS[panel].label),
                      tier: t(TIER_KEYS[tier]),
                    })}
                    onBlur={(event) => {
                      const box = event.currentTarget;
                      const held = thresholds[panel][at];
                      if (box.valueAsNumber === held) return;
                      const taken = take(panel, at, box.valueAsNumber);
                      if (!taken) box.value = String(held);
                      setRefused(!taken);
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {refused ? (
        <p className="inline-error" role="status">
          {t("flood.mustClimb")}
        </p>
      ) : null}
      <button
        type="button"
        className="secondary-button"
        disabled={!changed}
        onClick={() => {
          setRefused(false);
          onThresholds(normalizeFloodThresholds(null));
        }}
      >
        {t("flood.reset")}
      </button>
    </div>
  );
}
