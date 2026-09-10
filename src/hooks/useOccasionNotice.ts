import type { ToastMessage } from "../components/ToastHost";
import type { AppSettings } from "../lib/settings";
import { translate, type StringKey } from "../i18n";
import { useAppearance } from "./useAppearance";
import { useEffect } from "react";

/**
 * One line, once a year, the first time a seasonal pack is on screen.
 *
 * It carries the way to send that occasion away until next year; the switch
 * that ends them for good is in Settings, because a toast is not where
 * somebody makes a decision they will not revisit.
 */
export interface OccasionNoticeOptions {
  appearance: ReturnType<typeof useAppearance>;
  hydrated: boolean;
  settingsRef: { current: AppSettings };
  onSettings: (next: AppSettings) => void;
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
}

export function useOccasionNotice({
  appearance,
  hydrated,
  settingsRef,
  onSettings: applySettings,
  pushToast,
}: OccasionNoticeOptions): void {
  // One line, once a year, the first time a pack is on screen. It carries the
  // way to send that occasion away until next year; the switch that ends them
  // for good is in Settings, because a toast is not where somebody makes a
  // decision they will not revisit.
  useEffect(() => {
    const { occasion, year, showing } = appearance;
    if (!showing || !occasion) return;
    // Not until the stored settings are in. Before they are, `settings` is
    // the defaults, so writing to them here saved a file of defaults over the
    // reader's own workspace and then gave the notice a second time once the
    // real file arrived.
    if (!hydrated) return;
    const current = settingsRef.current;
    if (current.occasions.seen[occasion] === year) return;
    applySettings({
      ...current,
      occasions: {
        ...current.occasions,
        seen: { ...current.occasions.seen, [occasion]: year },
      },
    });
    pushToast({
      title: translate(`occasion.${occasion}` as StringKey),
      detail: translate("occasion.notice"),
      actionLabel: translate("occasion.notThisYear"),
      onAction: () => {
        const now = settingsRef.current;
        applySettings({
          ...now,
          occasions: {
            ...now.occasions,
            declined: { ...now.occasions.declined, [occasion]: year },
          },
        });
      },
    });
  }, [appearance, applySettings, hydrated, pushToast, settingsRef]);
}
