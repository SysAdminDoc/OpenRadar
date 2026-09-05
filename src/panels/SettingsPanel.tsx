import { BellRing, Crosshair, RotateCcw, X, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { PanelShell } from "../components/PanelShell";
import { rangeFill } from "../lib/rangeFill";
import { MAX_LOOP_VOLUMES, MIN_LOOP_VOLUMES } from "../lib/siteLoop";
import type { NotifyPermission } from "../lib/notify";
import {
  distanceSlider,
  distanceUnit,
  distanceValue,
  formatAge,
  formatClock,
  formatDistance,
  milesFromDistance,
  TEXT_SCALES,
  unitsForLanguage,
} from "../lib/units";
import type { AppSettings, WatchState } from "../lib/settings";
import type { PackBounds } from "../lib/incidentPacks";
import { watchedPlaces, watchesAnything } from "../lib/settings";
import { useForcedColours } from "../hooks/useClock";
import { useOfflineSince } from "../hooks/useOffline";
import { IncidentPackManager } from "./IncidentPackManager";
import { StorageSection } from "./StorageSection";
import type { UndoableRemoval } from "../components/ToastHost";
import { formatNumber, LANGUAGES, useT } from "../i18n";
import { themeAccent, themeFromAccent } from "../lib/theme";
import type { AmbientState } from "../hooks/useAmbient";
import { JournalSection } from "./JournalSection";
import { playAlertTone } from "../lib/sound";
import { openGlance } from "../lib/tray";
import { giveSpeculationBack, putSpeculationAway } from "../lib/calm";
import { WALLPAPER_EVERY, wallpaperAvailable } from "../lib/wallpaper";
import { RecapSection } from "./RecapSection";
import { CuriositySection } from "./CuriositySection";
import {
  MAX_WATCH_PLACES,
  WATCH_FAILURES_BEFORE_SAYING,
  WATCH_HEALTHY,
  type WatchHealth,
} from "../lib/watch";
import { APPROACH_MINUTES } from "../lib/approach";
import { LIGHTNING_COUNTS, LIGHTNING_RADII } from "../lib/lightningWatch";

/**
 * Minutes past midnight as a time field reads them, and back again.
 *
 * A time input speaks "HH:MM" and the setting is a single number, which is the
 * shape the midnight wrap is easiest to reason about. A field that is cleared
 * gives an empty string, so the previous value is kept rather than resetting
 * the window to midnight under the reader.
 */
function minuteToTime(minute: number): string {
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  const minutes = String(minute % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function timeToMinute(value: string, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return fallback;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return Number.isFinite(minute) && minute >= 0 && minute < 1440
    ? minute
    : fallback;
}

interface SettingsPanelProps {
  settings: AppSettings;
  bounds?: PackBounds | null;
  onSettings: (next: AppSettings | ((now: AppSettings) => AppSettings)) => void;
  onSendWatchTest: () => void;
  /**
   * Whether the watch is still hearing back from the service.
   *
   * The watch is the one thing in the app that runs whether or not anybody
   * is looking, so it is the one thing that has to say when it has stopped.
   */
  watchHealth?: WatchHealth;
  /** What Windows has said about notifications, for the line below. */
  notifications?: NotifyPermission;
  /** What the chrome is drawing, so the switch can name its source. */
  ambient: AmbientState;
  /** The record was written to a file, at this path when there is one. */
  /** A backup chosen from the picker, read by the same reader Upload uses. */
  onImportSettings: (file: File) => void;
  onJournalSaved: (path: string | null) => void;
  onJournalFailed: (why: string) => void;
  /** How much came back from emptying the cache, already in words. */
  onStorageCleared: (freed: string) => void;
  onStorageFailed: (why: string) => void;
  onJournalCleared: (undo: () => void) => void;
  onJournalRemoved: (undo: () => void) => void;
  /** Something the reader removed here, and the way back to it. */
  onRemoved: (removal: UndoableRemoval) => void;
  /**
   * Whether the app is registered to start with the machine, or `null` when
   * nobody can say: a browser preview, or a machine that refused to answer.
   *
   * Not a setting. The registry entry is what decides what happens at the
   * next boot, so it is read from the machine rather than stored.
   */
  autostart: boolean | null;
  onAutostart: (on: boolean) => void;
  /** Ticks once a minute, so the record on screen notices a row arriving. */
  clock: number;
  onWatchHere: () => void;
  /** Adds the map centre as another watched place. */
  onAddWatchPlace: () => void;
  onReset: () => void;
  onExportSettings: () => Promise<void>;
  /** Asks for a sound file of the reader's own, or leaves it as it was. */
  onChooseSound: () => Promise<void>;
  onClose: () => void;
}

interface ToggleSettingProps {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleSetting({
  label,
  detail,
  checked,
  onChange,
}: ToggleSettingProps) {
  return (
    <label className="toggle-row toggle-row--plain">
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i className="toggle-track" aria-hidden="true" />
    </label>
  );
}

/**
 * What the colour control shows before anybody has chosen anything.
 *
 * The built-in accent per theme, copied from the LAST accent declaration in
 * `index.css` rather than the first: the stylesheet sets it twice and the
 * later pair is what a reader is looking at. A colour input has no "unset"
 * state, so it has to open on something, and opening on the colour actually
 * on screen is the only honest choice, so `theme.test.ts` holds these two in
 * step with the stylesheet.
 */
const BUILT_IN_ACCENT: Record<AppSettings["theme"], string> = {
  dark: "#4bc0ff",
  light: "#0879b8",
};

export function SettingsPanel({
  settings,
  bounds = null,
  onSettings,
  ambient,
  onImportSettings,
  onJournalSaved,
  onJournalFailed,
  onStorageCleared,
  onStorageFailed,
  onJournalCleared,
  onJournalRemoved,
  onRemoved,
  autostart,
  onAutostart,
  clock,
  onSendWatchTest,
  watchHealth = WATCH_HEALTHY,
  notifications,
  onWatchHere,
  onAddWatchPlace,
  onReset,
  onExportSettings,
  onChooseSound,
  onClose,
}: SettingsPanelProps) {
  const t = useT();
  // Home counts, and only places actually switched on: a storm heading for a
  // place nobody is watching is not news. Counted through `watchedPlaces`,
  // which applies the cap, because with ten saved places the tenth is never
  // watched and counting it here would say otherwise.
  const watchedPlaceCount = watchedPlaces(settings).filter(
    (place) => place.enabled,
  ).length;
  // Both halves of the notice: somewhere for a storm to be heading, and the
  // tracker that finds one.
  // A place to watch is all either of these needs. The layer used to be part
  // of it, which made the switch read as off for a reader who had turned the
  // cells or the flashes off the map: the stored rule stayed on, so switching
  // the layer back on weeks later silently re-armed a watch the panel had
  // been showing as off. Each feed now runs for its own watch.
  const approachPossible = watchedPlaceCount > 0;
  const lightningPossible = watchedPlaceCount > 0;
  // Whether the system has taken the colours over, which is not a preference
  // this app can honour halfway.
  const forcedColours = useForcedColours();
  // Whether the machine can reach anything at all, which is a different
  // answer from whether a service is answering.
  const offlineSince = useOfflineSince();

  // Asked once: whether this machine can have its wallpaper set cannot change
  // while the app is running. Null until the answer comes back, so the
  // control neither promises nor refuses before it knows.
  const [wallpaperOk, setWallpaperOk] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void wallpaperAvailable().then((ok) => {
      if (alive) setWallpaperOk(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const accent = themeAccent(settings.workspaceTheme);

  // The watched radius is stored in miles, which is what the watch works in,
  // and read in whatever the reader reads in.
  const radiusSlider = distanceSlider(5, 200);
  const radiusShown = Math.min(
    radiusSlider.max,
    Math.max(
      radiusSlider.min,
      Math.round(
        distanceValue(settings.watch.radiusMiles) / radiusSlider.step,
      ) * radiusSlider.step,
    ),
  );
  const updateRadar = (patch: Partial<AppSettings["radar"]>) =>
    onSettings({ ...settings, radar: { ...settings.radar, ...patch } });

  return (
    <PanelShell
      eyebrow={t("settings.eyebrow")}
      title={t("settings.title")}
      onClose={onClose}
      className="surface-panel--right surface-panel--settings"
    >
      <div className="settings-section">
        <div className="settings-section__title">
          <span>{t("settings.appearance")}</span>
          <small>{t("settings.appliesNow")}</small>
        </div>
        <div
          className="segmented-control segmented-control--full"
          role="group"
          aria-label={t("settings.theme")}
        >
          <button
            type="button"
            className={settings.theme === "dark" ? "is-active" : ""}
            aria-pressed={settings.theme === "dark"}
            disabled={forcedColours}
            onClick={() => onSettings({ ...settings, theme: "dark" })}
          >
            {t("settings.dark")}
          </button>
          <button
            type="button"
            className={settings.theme === "light" ? "is-active" : ""}
            aria-pressed={settings.theme === "light"}
            disabled={forcedColours}
            onClick={() => onSettings({ ...settings, theme: "light" })}
          >
            {t("settings.light")}
          </button>
        </div>
        {/* A contrast theme repaints everything in the system's own colours,
            so neither of those buttons would draw anything. Said out loud
            rather than left as two buttons that quietly do nothing. */}
        {forcedColours ? (
          <p className="source-note" data-forced-colours>
            {t("settings.systemColours")}
          </p>
        ) : null}
        <label className="accent-row">
          <span>
            <strong>{t("settings.accent")}</strong>
            <small>{t("settings.accentDetail")}</small>
          </span>
          <input
            type="color"
            value={accent ?? BUILT_IN_ACCENT[settings.theme]}
            aria-label={t("settings.accent")}
            onChange={(event) =>
              onSettings({
                ...settings,
                workspaceTheme:
                  themeFromAccent(
                    event.target.value,
                    settings.theme,
                    t("settings.accent"),
                  ) ?? settings.workspaceTheme,
              })
            }
          />
        </label>
        <ToggleSetting
          label={t("settings.ambient")}
          detail={t("settings.ambientDetail")}
          checked={settings.ambient}
          onChange={(on) => onSettings({ ...settings, ambient: on })}
        />
        {/* The source and the age, where the reader turned it on. An effect
            driven by an observation nobody can name is decoration pretending
            to be data. */}
        {settings.ambient ? (
          <p className="source-note">
            {!settings.watch.enabled
              ? // Nothing is fetched at all without one, so saying no station
                // is reporting weather would be a claim about the sky rather
                // than about the setting.
                t("settings.ambientNeedsWatch")
              : ambient.dropped
                ? t("settings.ambientDropped")
                : ambient.seen
                  ? t("settings.ambientSeen", {
                      station: ambient.seen.station,
                      when: formatClock(ambient.seen.observed),
                    })
                  : t("settings.ambientQuiet")}
          </p>
        ) : null}
        <div className="settings-field" data-ambient-screen-setting>
          <span>
            <strong>{t("ambientScreen.setting")}</strong>
            <small>{t("ambientScreen.settingDetail")}</small>
          </span>
          <label className="settings-field">
            <span>{t("ambientScreen.idle")}</span>
            <select
              value={String(settings.ambientIdleMinutes)}
              onChange={(event) =>
                onSettings({
                  ...settings,
                  ambientIdleMinutes: Number(event.target.value),
                })
              }
            >
              {/* Never, by default. A workspace that takes itself over while
                  somebody is reading is a workspace they stop leaving open. */}
              <option value="0">{t("ambientScreen.idleOff")}</option>
              {[5, 15, 30, 60].map((minutes) => (
                <option key={minutes} value={String(minutes)}>
                  {t("ambientScreen.idleMinutes", { minutes })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ToggleSetting
          label={t("tray.setting")}
          detail={t("tray.settingDetail")}
          checked={settings.tray}
          onChange={(tray) => onSettings({ ...settings, tray })}
        />
        {/* Only with the icon on. The entry opens the app to the tray, and
            with no icon there is nothing for it to open to: the switch says so
            rather than registering something that would start a window across
            the reader's screen at every boot. */}
        <div className="settings-field" data-autostart-setting>
          <label className="toggle-row toggle-row--plain">
            <span>
              <strong>{t("autostart.setting")}</strong>
              <small>
                {!settings.tray
                  ? t("autostart.needsTray")
                  : autostart === null
                    ? t("autostart.unavailable")
                    : t("autostart.settingDetail")}
              </small>
            </span>
            <input
              type="checkbox"
              // The entry, not the reader's intent. With the icon off the
              // switch cannot be moved, and drawing a registered entry as off
              // would say the app will not start with the machine when it
              // will: it starts, and shows its window, because there is no
              // icon for it to open to.
              checked={autostart === true}
              disabled={!settings.tray || autostart === null}
              onChange={(event) => onAutostart(event.target.checked)}
            />
            <i className="toggle-track" aria-hidden="true" />
          </label>
        </div>
        {settings.tray ? (
          <>
            <ToggleSetting
              label={t("tray.closeToTray")}
              detail={t("tray.closeToTrayDetail")}
              checked={settings.closeToTray}
              onChange={(closeToTray) =>
                onSettings({ ...settings, closeToTray })
              }
            />
            <ToggleSetting
              label={t("glance.onTop")}
              detail={t("glance.settingDetail")}
              checked={settings.glanceOnTop}
              onChange={(glanceOnTop) =>
                onSettings({ ...settings, glanceOnTop })
              }
            />
            <button
              type="button"
              className="secondary-button"
              onClick={() => void openGlance()}
            >
              {t("glance.setting")}
            </button>
          </>
        ) : null}
        {/* Windows only for now, and it says so rather than offering a
            control that would quietly do nothing. */}
        <div className="settings-field" data-wallpaper-setting>
          <span>
            <strong>{t("wallpaper.setting")}</strong>
            <small>
              {wallpaperOk === false
                ? t("wallpaper.unavailable")
                : t("wallpaper.settingDetail")}
            </small>
          </span>
          <label className="settings-field">
            <span>{t("wallpaper.every")}</span>
            <select
              value={String(settings.wallpaperMinutes)}
              disabled={wallpaperOk === false}
              onChange={(event) =>
                onSettings({
                  ...settings,
                  wallpaperMinutes: Number(event.target.value),
                })
              }
            >
              <option value="0">{t("wallpaper.never")}</option>
              {WALLPAPER_EVERY.filter((every) => every > 0).map((every) => (
                <option key={every} value={String(every)}>
                  {t("wallpaper.everyMinutes", { minutes: every })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ToggleSetting
          label={t("calm.setting")}
          detail={t("calm.settingDetail")}
          checked={settings.calm}
          onChange={(calm) =>
            onSettings(
              calm
                ? putSpeculationAway(settings)
                : giveSpeculationBack(settings),
            )
          }
        />
        <ToggleSetting
          label={t("curiosity.setting")}
          detail={t("curiosity.settingDetail")}
          checked={settings.curiosities}
          onChange={(curiosities) => onSettings({ ...settings, curiosities })}
        />
        <ToggleSetting
          label={t("catchUp.setting")}
          detail={t("catchUp.settingDetail")}
          checked={settings.catchUp}
          onChange={(catchUp) => onSettings({ ...settings, catchUp })}
        />
        <ToggleSetting
          label={t("settings.almanac")}
          detail={t("settings.almanacDetail")}
          checked={settings.almanac}
          onChange={(almanac) => onSettings({ ...settings, almanac })}
        />
        <ToggleSetting
          label={t("settings.occasions")}
          detail={t("settings.occasionsDetail")}
          checked={settings.occasions.enabled}
          onChange={(enabled) =>
            onSettings({
              ...settings,
              occasions: { ...settings.occasions, enabled },
            })
          }
        />
        {settings.workspaceTheme ? (
          <>
            <p className="source-note">
              {t("settings.themeInForce", {
                name: settings.workspaceTheme.name,
              })}
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                const removed = settings.workspaceTheme;
                onSettings({ ...settings, workspaceTheme: null });
                if (!removed) return;
                onRemoved({
                  title: t("settings.themeRemoved", { name: removed.name }),
                  detail: t("settings.themeRemovedBody"),
                  // Only the theme, put back over whatever else the reader
                  // changed while the toast was up. The settings arrive from
                  // the applier rather than a copy held here, so closing the
                  // panel while the toast is up cannot freeze them.
                  undo: () =>
                    onSettings((now) => ({ ...now, workspaceTheme: removed })),
                });
              }}
            >
              {t("settings.themeClear")}
            </button>
          </>
        ) : (
          <p className="source-note">{t("settings.themeNote")}</p>
        )}
      </div>

      <JournalSection
        clock={clock}
        writing={settings.journal}
        onWriting={(journal) => onSettings({ ...settings, journal })}
        onSaved={(path) => onJournalSaved(path)}
        onFailed={(why) => onJournalFailed(why)}
        onCleared={onJournalCleared}
        onRemoved={onJournalRemoved}
      />

      {settings.curiosities ? (
        <CuriositySection
          found={settings.curiositiesFound}
          // The one removal in here that had no way back, against a rule
          // this section is written under: everything is reversible in one
          // action. What is lost is a list somebody built by going and
          // looking at places, which is not a list they can rebuild by
          // pressing anything.
          onForget={() => {
            const held = settings.curiositiesFound;
            onSettings({ ...settings, curiositiesFound: [] });
            onRemoved({
              title: t("curiosity.forgotten"),
              detail: t("curiosity.forgottenBody"),
              // Into the settings as they stand when the undo is pressed,
              // rather than the whole of what they were: anything else the
              // reader changed in between is theirs to keep.
              undo: () =>
                onSettings((now) => ({
                  ...now,
                  // Put back, not written over. A curiosity is found by the
                  // camera coming to rest near one, which needs no panel
                  // interaction at all, so anything discovered while the
                  // toast was up was being lost by pressing undo.
                  curiositiesFound: [
                    ...held,
                    ...now.curiositiesFound.filter(
                      (found) => !held.includes(found),
                    ),
                  ],
                })),
            });
          }}
        />
      ) : null}

      <RecapSection
        clock={clock}
        onSaved={(path) => onJournalSaved(path)}
        onFailed={(why) => onJournalFailed(why)}
      />

      <IncidentPackManager
        settings={settings}
        bounds={bounds}
        onSettings={onSettings}
        onRemoved={onRemoved}
      />

      <StorageSection
        onCleared={(freed) => onStorageCleared(freed)}
        onFailed={(why) => onStorageFailed(why)}
      />

      <div className="settings-section">
        <div className="settings-section__title">
          <span>{t("settings.language")}</span>
          <small>{t("settings.languageNote")}</small>
        </div>
        <div
          className="segmented-control segmented-control--full"
          role="group"
          aria-label={t("settings.language")}
        >
          {LANGUAGES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={settings.language === option.id ? "is-active" : ""}
              aria-pressed={settings.language === option.id}
              onClick={() =>
                onSettings({
                  ...settings,
                  language: option.id,
                  // Somebody who picks Français and is then shown Fahrenheit
                  // has to go and find the Units row to finish the job. Only
                  // until they pick for themselves, though: after that the
                  // choice is theirs.
                  units: settings.unitsChosen
                    ? settings.units
                    : unitsForLanguage(option.id),
                })
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">
          <span>{t("settings.backup")}</span>
          <small>{t("settings.backupDetail")}</small>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void onExportSettings()}
        >
          {t("settings.export")}
        </button>
        {/* Beside Export, because the pair is the point. Restoring one worked
            already, by knowing to drop the file on the Upload panel, which
            nothing here said. The file goes through the very same reader, so
            a partial restore says so and the undo is the same undo. */}
        <label className="secondary-button settings-import">
          <span>{t("settings.import")}</span>
          <input
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportSettings(file);
              // Cleared so choosing the same file twice is two imports.
              event.target.value = "";
            }}
          />
        </label>
        {/* Somebody who wants the greeting back can have it. Shown once is a
            rule about not repeating myself, not a rule about never again. */}
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            onSettings({ ...settings, seenWelcome: false, seenReveal: false })
          }
        >
          {t("opening.showAgain")}
        </button>
        <p className="source-note">{t("opening.showAgainDetail")}</p>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">
          <span>{t("settings.units")}</span>
        </div>
        <div
          className="segmented-control segmented-control--full"
          role="group"
          aria-label={t("settings.units")}
        >
          {(["imperial", "metric"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={settings.units === option ? "is-active" : ""}
              aria-pressed={settings.units === option}
              onClick={() =>
                // Chosen, from here on. A later change of language leaves
                // this alone.
                onSettings({ ...settings, units: option, unitsChosen: true })
              }
            >
              {option === "imperial"
                ? t("settings.unitsImperial")
                : t("settings.unitsMetric")}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">
          <span>{t("settings.clock")}</span>
          <small>{t("settings.clockDetail")}</small>
        </div>
        <div
          className="segmented-control segmented-control--full"
          role="group"
          aria-label={t("settings.clock")}
        >
          {(["local", "utc"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={settings.clock === option ? "is-active" : ""}
              aria-pressed={settings.clock === option}
              onClick={() => onSettings({ ...settings, clock: option })}
            >
              {option === "local"
                ? t("settings.clockLocal")
                : t("settings.clockUtc")}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">
          <span>{t("settings.textSize")}</span>
          <small>{t("settings.textSizeDetail")}</small>
        </div>
        <div
          className="segmented-control segmented-control--full"
          role="group"
          aria-label={t("settings.textSize")}
        >
          {TEXT_SCALES.map((option) => (
            <button
              key={option}
              type="button"
              className={settings.textScale === option ? "is-active" : ""}
              aria-pressed={settings.textScale === option}
              onClick={() => onSettings({ ...settings, textScale: option })}
            >
              {option}%
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">
          <span>{t("settings.radar")}</span>
          <small>{t("settings.baseReflectivity")}</small>
        </div>
        <label className="range-row">
          <span>
            <strong>{t("settings.opacity")}</strong>
            <output>{Math.round(settings.radar.opacity * 100)}%</output>
          </span>
          <input
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            style={rangeFill(settings.radar.opacity, 0.05, 1)}
            aria-label={t("settings.opacityLabel")}
            aria-valuetext={`${Math.round(settings.radar.opacity * 100)}%`}
            value={settings.radar.opacity}
            onChange={(event) =>
              updateRadar({ opacity: Number(event.target.value) })
            }
          />
        </label>
        <label className="range-row">
          <span>
            <strong>{t("settings.animationSpeed")}</strong>
            <output>{formatNumber(settings.radar.animationSpeed, 1)}</output>
          </span>
          <input
            type="range"
            min="-0.8"
            max="0.5"
            step="0.1"
            style={rangeFill(settings.radar.animationSpeed, -0.8, 0.5)}
            aria-label={t("settings.animationSpeedLabel")}
            aria-valuetext={formatNumber(settings.radar.animationSpeed, 1)}
            value={settings.radar.animationSpeed}
            onChange={(event) =>
              updateRadar({ animationSpeed: Number(event.target.value) })
            }
          />
        </label>
        <label className="range-row">
          <span>
            <strong>{t("settings.loopLength")}</strong>
            <output>
              {t("settings.minutes", { count: settings.radar.loopMinutes })}
            </output>
          </span>
          <input
            type="range"
            min="60"
            max="120"
            step="10"
            style={rangeFill(settings.radar.loopMinutes, 60, 120)}
            aria-label={t("settings.loopLengthLabel")}
            aria-valuetext={t("settings.minutes", {
              count: settings.radar.loopMinutes,
            })}
            value={settings.radar.loopMinutes}
            onChange={(event) =>
              updateRadar({ loopMinutes: Number(event.target.value) })
            }
          />
        </label>
        <label className="range-row">
          <span>
            <strong>{t("settings.siteLoopLength")}</strong>
            <output>
              {t("settings.volumes", { count: settings.radar.loopVolumes })}
            </output>
          </span>
          <input
            type="range"
            min={MIN_LOOP_VOLUMES}
            max={MAX_LOOP_VOLUMES}
            step="1"
            style={rangeFill(
              settings.radar.loopVolumes,
              MIN_LOOP_VOLUMES,
              MAX_LOOP_VOLUMES,
            )}
            aria-label={t("settings.siteLoopLengthLabel")}
            aria-valuetext={t("settings.volumes", {
              count: settings.radar.loopVolumes,
            })}
            value={settings.radar.loopVolumes}
            onChange={(event) =>
              updateRadar({ loopVolumes: Number(event.target.value) })
            }
          />
        </label>
        <ToggleSetting
          label={t("settings.futureRadar")}
          detail={t("settings.futureRadarDetail")}
          checked={settings.radar.futureRadar}
          onChange={(futureRadar) => updateRadar({ futureRadar })}
        />
        <ToggleSetting
          label={t("settings.showRadar")}
          detail={t("settings.showRadarDetail")}
          checked={settings.radar.enabled}
          onChange={(enabled) => updateRadar({ enabled })}
        />
      </div>

      <div className="settings-section">
        <div className="settings-section__title">
          <span>{t("settings.watchedArea")}</span>
          <small>{t("settings.watchedAreaNote")}</small>
        </div>
        <ToggleSetting
          label={t("settings.tellMe")}
          detail={t("settings.tellMeDetail")}
          checked={settings.watch.enabled}
          onChange={(enabled) =>
            onSettings({ ...settings, watch: { ...settings.watch, enabled } })
          }
        />
        {/* Home is a coordinate pair until somebody calls it something, and
            a place with a name is the difference between a viewer and a
            workspace. It is a label and nothing else: nothing about what is
            polled, or how often, reads it. */}
        <label className="watch-place__name">
          <span>{t("settings.homeName")}</span>
          <input
            type="text"
            maxLength={60}
            value={settings.watch.name ?? ""}
            placeholder={t("watch.home")}
            aria-label={t("settings.homeName")}
            onChange={(event) =>
              onSettings({
                ...settings,
                watch: { ...settings.watch, name: event.target.value },
              })
            }
          />
        </label>
        <ToggleSetting
          label={t("alerts.sound")}
          detail={t("alerts.soundDetail")}
          checked={settings.watch.sound}
          onChange={(sound) =>
            onSettings({ ...settings, watch: { ...settings.watch, sound } })
          }
        />
        {settings.watch.sound ? (
          <>
            <label className="range-row">
              <span>
                <strong>{t("alerts.volume")}</strong>
                <output>
                  {t("alerts.volumeValue", {
                    percent: Math.round(settings.alertVolume * 100),
                  })}
                </output>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                style={rangeFill(
                  Math.round(settings.alertVolume * 100),
                  0,
                  100,
                )}
                aria-valuetext={t("alerts.volumeValue", {
                  percent: Math.round(settings.alertVolume * 100),
                })}
                value={Math.round(settings.alertVolume * 100)}
                onChange={(event) =>
                  onSettings({
                    ...settings,
                    alertVolume: Number(event.target.value) / 100,
                  })
                }
              />
            </label>
            <div className="sound-kit">
              {/* Heard before it is committed to. A sound somebody has not
                  heard is a sound they find out about during a warning,
                  which is the worst moment to discover it is wrong. */}
              <p className="source-note">{t("alerts.previewNote")}</p>
              <div className="sound-kit__row">
                {(["minor", "moderate", "severe", "extreme"] as const).map(
                  (severity) => (
                    <button
                      key={severity}
                      type="button"
                      className="secondary-button"
                      data-sound-preview={severity}
                      onClick={() =>
                        void playAlertTone(severity, { preview: true })
                      }
                    >
                      <Volume2 size={14} /> {t(`alerts.severity.${severity}`)}
                    </button>
                  ),
                )}
              </div>
            </div>
            <div className="sound-kit">
              <p className="source-note">
                <strong>{t("alerts.soundFile")}</strong>
              </p>
              <p className="source-note">{t("alerts.soundFileDetail")}</p>
              {settings.alertSoundPath ? (
                <p className="source-note" data-alert-sound-path>
                  {settings.alertSoundPath}
                </p>
              ) : null}
              <div className="sound-kit__row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void onChooseSound()}
                >
                  {t("alerts.soundFileChoose")}
                </button>
                {settings.alertSoundPath ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      const removed = settings.alertSoundPath;
                      onSettings({ ...settings, alertSoundPath: null });
                      if (!removed) return;
                      onRemoved({
                        title: t("alerts.soundFileRemoved"),
                        detail: t("alerts.soundFileRemovedBody"),
                        undo: () =>
                          onSettings((now) => ({
                            ...now,
                            alertSoundPath: removed,
                          })),
                      });
                    }}
                  >
                    {t("alerts.soundFileClear")}
                  </button>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
        {/* A different kind of statement from everything above it, and said
            so: the watch repeats a forecaster and this is arithmetic on a
            moving blob. Off until asked for, and silent even then. */}
        <div className="settings-field" data-approach-setting>
          <label className="toggle-row toggle-row--plain">
            <span>
              <strong>{t("approach.setting")}</strong>
              <small>
                {watchedPlaceCount === 0
                  ? t("approach.needsPlace")
                  : t("approach.settingDetail")}
              </small>
            </span>
            <input
              type="checkbox"
              // Both, because the notice is made of two things: somewhere
              // for a storm to be heading, and the tracker that finds one.
              // Switched on with the tracker off it would simply never fire,
              // which is worse than saying why.
              checked={settings.approach.enabled && approachPossible}
              disabled={!approachPossible}
              onChange={(event) =>
                onSettings({
                  ...settings,
                  approach: {
                    ...settings.approach,
                    enabled: event.target.checked,
                  },
                })
              }
            />
            <i className="toggle-track" aria-hidden="true" />
          </label>
        </div>
        {settings.approach.enabled && approachPossible ? (
          <>
            <div className="settings-field" data-approach-window>
              <span>
                <strong>{t("approach.window")}</strong>
              </span>
              <div
                className="segmented-control segmented-control--full"
                role="group"
                aria-label={t("approach.window")}
              >
                {APPROACH_MINUTES.map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={
                      settings.approach.minutes === count ? "is-active" : ""
                    }
                    aria-pressed={settings.approach.minutes === count}
                    onClick={() =>
                      onSettings({
                        ...settings,
                        approach: { ...settings.approach, minutes: count },
                      })
                    }
                  >
                    {t("approach.windowMinutes", { count })}
                  </button>
                ))}
              </div>
            </div>
            <ToggleSetting
              label={t("approach.sound")}
              detail={t("approach.soundDetail")}
              checked={settings.approach.sound}
              onChange={(sound) =>
                onSettings({
                  ...settings,
                  approach: { ...settings.approach, sound },
                })
              }
            />
          </>
        ) : null}
        {/* The same shape as the approach notice above, and it needs the
            same one thing: somewhere for lightning to fall near. The layer
            was part of it and is not: a watch that stops when its layer is
            switched off is a watch that stops when nobody is looking. */}
        <div className="settings-field" data-lightning-watch>
          <label className="toggle-row toggle-row--plain">
            <span>
              <strong>{t("lightningWatch.setting")}</strong>
              <small>
                {watchedPlaceCount === 0
                  ? t("lightningWatch.needsPlace")
                  : t("lightningWatch.settingDetail")}
              </small>
            </span>
            <input
              type="checkbox"
              checked={settings.lightningWatch.enabled && lightningPossible}
              disabled={!lightningPossible}
              onChange={(event) =>
                onSettings({
                  ...settings,
                  lightningWatch: {
                    ...settings.lightningWatch,
                    enabled: event.target.checked,
                  },
                })
              }
            />
            <i className="toggle-track" aria-hidden="true" />
          </label>
        </div>
        {settings.lightningWatch.enabled && lightningPossible ? (
          <>
            <div className="settings-field" data-lightning-radius>
              <span>
                <strong>{t("lightningWatch.radius")}</strong>
              </span>
              <div
                className="segmented-control segmented-control--full"
                role="group"
                aria-label={t("lightningWatch.radius")}
              >
                {LIGHTNING_RADII.map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={
                      settings.lightningWatch.radiusMiles === count
                        ? "is-active"
                        : ""
                    }
                    aria-pressed={settings.lightningWatch.radiusMiles === count}
                    onClick={() =>
                      onSettings({
                        ...settings,
                        lightningWatch: {
                          ...settings.lightningWatch,
                          radiusMiles: count,
                        },
                      })
                    }
                  >
                    {/* The short form, which is what fits in a chip:
                        "16 km" rather than "16 kilometres". */}
                    {formatDistance(count)}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-field" data-lightning-count>
              <span>
                <strong>{t("lightningWatch.count")}</strong>
                <small>{t("lightningWatch.note")}</small>
              </span>
              <div
                className="segmented-control segmented-control--full"
                role="group"
                aria-label={t("lightningWatch.count")}
              >
                {LIGHTNING_COUNTS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={
                      settings.lightningWatch.count === count ? "is-active" : ""
                    }
                    aria-pressed={settings.lightningWatch.count === count}
                    onClick={() =>
                      onSettings({
                        ...settings,
                        lightningWatch: { ...settings.lightningWatch, count },
                      })
                    }
                  >
                    {t("lightningWatch.countFlashes", { count })}
                  </button>
                ))}
              </div>
            </div>
            <ToggleSetting
              label={t("lightningWatch.sound")}
              detail={t("lightningWatch.soundDetail")}
              checked={settings.lightningWatch.sound}
              onChange={(sound) =>
                onSettings({
                  ...settings,
                  lightningWatch: { ...settings.lightningWatch, sound },
                })
              }
            />
          </>
        ) : null}
        <ToggleSetting
          label={t("watch.followNew")}
          detail={t("watch.followNewDetail")}
          checked={settings.followNewWarnings}
          onChange={(followNewWarnings) =>
            onSettings({ ...settings, followNewWarnings })
          }
        />
        <label className="range-row">
          <span>
            <strong>{t("settings.radius")}</strong>
            <output>
              {t("settings.radiusValue", {
                distance: formatDistance(milesFromDistance(radiusShown)),
              })}
            </output>
          </span>
          <input
            type="range"
            // The slider steps in whatever the reader is reading in, so a
            // metric reader gets round numbers of kilometres rather than the
            // eight, sixteen and twenty-four that stepping in miles produces.
            min={radiusSlider.min}
            max={radiusSlider.max}
            step={radiusSlider.step}
            style={rangeFill(radiusShown, radiusSlider.min, radiusSlider.max)}
            aria-label={t("settings.radiusLabel", { unit: distanceUnit() })}
            aria-valuetext={t("settings.radiusValue", {
              distance: formatDistance(milesFromDistance(radiusShown)),
            })}
            // Snapped to the slider's own stops, so the thumb and the readout
            // beside it cannot disagree about where it is.
            value={radiusShown}
            onChange={(event) =>
              onSettings({
                ...settings,
                watch: {
                  ...settings.watch,
                  // Stored in miles, which is what the watch works in.
                  radiusMiles: milesFromDistance(Number(event.target.value)),
                },
              })
            }
          />
        </label>
        <button
          type="button"
          className="secondary-button"
          onClick={onWatchHere}
        >
          <Crosshair size={16} /> {t("settings.watchCentre")}
        </button>
        <ToggleSetting
          label={t("watch.quiet")}
          detail={t("watch.quietDetail")}
          checked={settings.watch.quietHours.enabled}
          onChange={(enabled) =>
            onSettings({
              ...settings,
              watch: {
                ...settings.watch,
                quietHours: { ...settings.watch.quietHours, enabled },
              },
            })
          }
        />
        {settings.watch.quietHours.enabled && (
          <div className="quiet-hours">
            <label>
              <span>{t("watch.quietFrom")}</span>
              <input
                type="time"
                value={minuteToTime(settings.watch.quietHours.startMinute)}
                onChange={(event) =>
                  onSettings({
                    ...settings,
                    watch: {
                      ...settings.watch,
                      quietHours: {
                        ...settings.watch.quietHours,
                        startMinute: timeToMinute(
                          event.target.value,
                          settings.watch.quietHours.startMinute,
                        ),
                      },
                    },
                  })
                }
              />
            </label>
            <label>
              <span>{t("watch.quietUntil")}</span>
              <input
                type="time"
                value={minuteToTime(settings.watch.quietHours.endMinute)}
                onChange={(event) =>
                  onSettings({
                    ...settings,
                    watch: {
                      ...settings.watch,
                      quietHours: {
                        ...settings.watch.quietHours,
                        endMinute: timeToMinute(
                          event.target.value,
                          settings.watch.quietHours.endMinute,
                        ),
                      },
                    },
                  })
                }
              />
            </label>
            <label>
              <span>{t("watch.quietOverride")}</span>
              <select
                value={settings.watch.quietHours.overrideSeverity}
                onChange={(event) =>
                  onSettings({
                    ...settings,
                    watch: {
                      ...settings.watch,
                      quietHours: {
                        ...settings.watch.quietHours,
                        overrideSeverity: event.target
                          .value as WatchState["quietHours"]["overrideSeverity"],
                      },
                    },
                  })
                }
              >
                <option value="extreme">{t("alerts.severity.extreme")}</option>
                <option value="severe">{t("alerts.severity.severe")}</option>
                <option value="moderate">
                  {t("alerts.severity.moderate")}
                </option>
              </select>
            </label>
          </div>
        )}
        <button
          type="button"
          className="secondary-button"
          onClick={onSendWatchTest}
        >
          <BellRing size={16} /> {t("watch.sendTest")}
        </button>
        <p className="source-note">{t("watch.sendTestDetail")}</p>
        <p className="source-note">
          {t("settings.watching", {
            lat: formatNumber(settings.watch.center[1], 2),
            lon: formatNumber(settings.watch.center[0], 2),
          })}
        </p>
        {/* Whether it is actually working. The panel said it was watching
            whatever had happened, and a watch that had stopped reaching the
            service at two in the morning looked exactly like one that was
            hearing back every forty-five seconds. */}
        {watchHealth.lastCheckedAt !== null &&
        watchHealth.failing < WATCH_FAILURES_BEFORE_SAYING ? (
          <p className="source-note" data-watch-checked>
            {t("watch.lastChecked", {
              // The minute clock, not the wall clock: reading the time
              // during a render is impure, and this line only has to be
              // right to the minute.
              age: formatAge((clock - watchHealth.lastCheckedAt) / 60_000),
            })}
          </p>
        ) : null}
        {/* Why it is not reaching anything, when the answer is the machine
            rather than the service. "Not reaching the service for an hour"
            reads as a service that is down, and sends a reader looking in
            the wrong place. */}
        {offlineSince !== null ? (
          <p className="watch-not-reaching" data-watch-offline>
            {t("watch.cannotSee", {
              age: formatAge((clock - offlineSince) / 60_000),
            })}
          </p>
        ) : watchHealth.failing >= WATCH_FAILURES_BEFORE_SAYING &&
          watchHealth.failingSince !== null ? (
          <p className="watch-not-reaching" data-watch-failing>
            {t("watch.notReaching", {
              age: formatAge((clock - watchHealth.failingSince) / 60_000),
            })}
          </p>
        ) : null}

        {/* A refused permission drops every watch to an in-app toast, which
            is exactly what nobody looking away from the screen sees. The
            settings are where a reader goes after a warning did not arrive,
            so the sentence belongs here as well as in the report. Only
            while a watch is actually on: with every watch off there is no
            channel being blocked, and a warning about one would sit there
            on every quiet afternoon. Any of them, not home's own switch:
            a reader with home off and a school watched, or with only the
            lightning rule on, is having notices dropped just the same. */}
        {notifications === "refused" && watchesAnything(settings) ? (
          <p className="watch-not-reaching" data-notifications-refused>
            {t("watch.notificationsRefused")}
          </p>
        ) : null}

        {/* The places beside home. One point cannot be home, a school and the
            far end of tomorrow's drive, and a reader who wants all three
            should not have to pick. */}
        {/* No role when there is nothing in it: a list that owns no list
            items is a broken list rather than an empty one, and axe reports it
            as something it could not decide rather than as a failure, which
            every gate in the suite drops on the floor. */}
        <div
          className="watch-places"
          role={settings.watchPlaces.length ? "list" : undefined}
        >
          {settings.watchPlaces.map((place, index) => (
            <div className="watch-place" role="listitem" key={place.id}>
              <label className="watch-place__name">
                <span className="visually-hidden">
                  {t("settings.placeName")}
                </span>
                <input
                  type="text"
                  value={place.name}
                  maxLength={60}
                  aria-label={t("settings.placeName")}
                  onChange={(event) =>
                    onSettings({
                      ...settings,
                      watchPlaces: settings.watchPlaces.map((one, at) =>
                        at === index
                          ? { ...one, name: event.target.value }
                          : one,
                      ),
                    })
                  }
                />
              </label>
              <div className="watch-place__row">
                <label>
                  <span>{t("settings.radius", { unit: distanceUnit() })}</span>
                  <input
                    type="number"
                    min={5}
                    max={200}
                    value={Math.round(distanceValue(place.radiusMiles))}
                    aria-label={t("settings.placeRadius", {
                      place: place.name,
                      unit: distanceUnit(),
                    })}
                    onChange={(event) =>
                      onSettings({
                        ...settings,
                        watchPlaces: settings.watchPlaces.map((one, at) =>
                          at === index
                            ? {
                                ...one,
                                radiusMiles: milesFromDistance(
                                  Number(event.target.value),
                                ),
                              }
                            : one,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  <span>{t("settings.placeSeverity")}</span>
                  <select
                    value={place.minSeverity}
                    aria-label={t("settings.placeSeverityFor", {
                      place: place.name,
                    })}
                    onChange={(event) =>
                      onSettings({
                        ...settings,
                        watchPlaces: settings.watchPlaces.map((one, at) =>
                          at === index
                            ? {
                                ...one,
                                minSeverity: event.target
                                  .value as WatchState["minSeverity"],
                              }
                            : one,
                        ),
                      })
                    }
                  >
                    <option value="extreme">
                      {t("alerts.severity.extreme")}
                    </option>
                    <option value="severe">
                      {t("alerts.severity.severe")}
                    </option>
                    <option value="moderate">
                      {t("alerts.severity.moderate")}
                    </option>
                    <option value="minor">{t("alerts.severity.minor")}</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  aria-label={t("settings.removePlace", { place: place.name })}
                  onClick={() => {
                    onSettings({
                      ...settings,
                      watchPlaces: settings.watchPlaces.filter(
                        (_, at) => at !== index,
                      ),
                    });
                    onRemoved({
                      title: t("settings.placeRemoved", { place: place.name }),
                      detail: t("settings.placeRemovedBody"),
                      // Back where it was in the list, into the list as it
                      // stands now, and not at all if it is already there.
                      undo: () =>
                        onSettings((now) => {
                          // By its own id, which is what a place is. Matching
                          // on the name and the point instead meant two places
                          // called the same thing at the same point could not
                          // both come back.
                          if (
                            now.watchPlaces.some((held) => held.id === place.id)
                          ) {
                            return now;
                          }
                          // Home is the tenth, so the list itself holds nine.
                          if (now.watchPlaces.length >= MAX_WATCH_PLACES - 1) {
                            return now;
                          }
                          const back = [...now.watchPlaces];
                          back.splice(Math.min(index, back.length), 0, place);
                          return { ...now, watchPlaces: back };
                        }),
                    });
                  }}
                >
                  <X size={14} />
                </button>
              </div>
              <p className="source-note">
                {t("settings.watching", {
                  lat: formatNumber(place.center[1], 2),
                  lon: formatNumber(place.center[0], 2),
                })}
              </p>
            </div>
          ))}
        </div>
        {settings.watchPlaces.length < MAX_WATCH_PLACES - 1 ? (
          <button
            type="button"
            className="secondary-button"
            onClick={onAddWatchPlace}
          >
            <Crosshair size={16} /> {t("settings.addPlace")}
          </button>
        ) : (
          <p className="source-note">
            {t("settings.placesFull", { count: MAX_WATCH_PLACES })}
          </p>
        )}
      </div>

      <div className="settings-section settings-section--camera">
        <div className="settings-section__title">
          <span>{t("settings.camera")}</span>
          <small>
            {settings.projection === "globe"
              ? t("mapType.globe")
              : t("mapType.flat")}
          </small>
        </div>
        <dl className="camera-grid">
          <div>
            <dt>{t("settings.zoom")}</dt>
            <dd>{formatNumber(settings.camera.zoom, 2)}</dd>
          </div>
          <div>
            <dt>{t("settings.bearing")}</dt>
            <dd>{formatNumber(settings.camera.bearing, 1)}°</dd>
          </div>
          <div>
            <dt>{t("settings.pitch")}</dt>
            <dd>{formatNumber(settings.camera.pitch, 1)}°</dd>
          </div>
          <div>
            <dt>{t("settings.center")}</dt>
            <dd>
              {formatNumber(settings.camera.center[1], 2)},{" "}
              {formatNumber(settings.camera.center[0], 2)}
            </dd>
          </div>
        </dl>
      </div>

      <button type="button" className="secondary-button" onClick={onReset}>
        <RotateCcw size={16} /> {t("settings.reset")}
      </button>
    </PanelShell>
  );
}
