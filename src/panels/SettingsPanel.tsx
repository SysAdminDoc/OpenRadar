import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { PanelShell } from "../components/PanelShell";
import { rangeFill } from "../lib/rangeFill";
import { MAX_LOOP_VOLUMES, MIN_LOOP_VOLUMES } from "../lib/siteLoop";
import type { NotifyPermission } from "../lib/notify";
import { formatClock, TEXT_SCALES, unitsForLanguage } from "../lib/units";
import type { AppSettings } from "../lib/settings";
import type { PackBounds } from "../lib/incidentPacks";
import { useForcedColours } from "../hooks/useClock";
import { IncidentPackManager } from "./IncidentPackManager";
import { StorageSection } from "./StorageSection";
import type { UndoableRemoval } from "../components/ToastHost";
import { formatNumber, LANGUAGES, useT } from "../i18n";
import { themeAccent, themeFromAccent } from "../lib/theme";
import type { AmbientState } from "../hooks/useAmbient";
import { JournalSection } from "./JournalSection";
import { openGlance } from "../lib/tray";
import { giveSpeculationBack, putSpeculationAway } from "../lib/calm";
import { displayAwakeAvailable } from "../lib/display";
import { WALLPAPER_EVERY, wallpaperAvailable } from "../lib/wallpaper";
import { RecapSection } from "./RecapSection";
import { CuriositySection } from "./CuriositySection";
import { WATCH_HEALTHY, type WatchHealth } from "../lib/watch";
import { ToggleSetting } from "../components/ToggleSetting";
import { WatchSection } from "./WatchSection";
import type { PlaceLightning } from "../lib/lightningWatch";
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
  /** What the lightning watch counted for each watched place. */
  placeLightning: readonly PlaceLightning[];
  onClose: () => void;
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
  placeLightning,
  onClose,
}: SettingsPanelProps) {
  const t = useT();
  // Whether the system has taken the colours over, which is not a preference
  // this app can honour halfway.
  const forcedColours = useForcedColours();

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

  // Same question, same reason: whether this build can hold the screen on
  // cannot change while it is running, and null until the answer is back so
  // the switch neither promises nor refuses before it knows.
  const [awakeOk, setAwakeOk] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void displayAwakeAvailable().then((ok) => {
      if (alive) setAwakeOk(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const accent = themeAccent(settings.workspaceTheme);

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
          <label className="toggle-row toggle-row--plain">
            <span>
              <strong>{t("ambientScreen.awake")}</strong>
              <small>{t("ambientScreen.awakeDetail")}</small>
            </span>
            <input
              type="checkbox"
              // Off where it cannot be honoured, rather than drawn on and
              // doing nothing: a switch that says the screen will stay on
              // when it will not is worse than no switch.
              checked={settings.displayAwake && awakeOk !== false}
              disabled={awakeOk !== true}
              onChange={(event) =>
                onSettings({ ...settings, displayAwake: event.target.checked })
              }
            />
            <i className="toggle-track" aria-hidden="true" />
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

      <WatchSection
        settings={settings}
        onSettings={onSettings}
        onRemoved={onRemoved}
        clock={clock}
        onSendWatchTest={onSendWatchTest}
        watchHealth={watchHealth}
        notifications={notifications}
        onWatchHere={onWatchHere}
        onAddWatchPlace={onAddWatchPlace}
        onChooseSound={onChooseSound}
        placeLightning={placeLightning}
      />

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
