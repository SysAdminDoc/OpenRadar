import { BellRing, Crosshair, X, Volume2 } from "lucide-react";
import { rangeFill } from "../lib/rangeFill";
import type { NotifyPermission } from "../lib/notify";
import {
  distanceSlider,
  distanceUnit,
  distanceValue,
  formatAge,
  formatDistance,
  milesFromDistance,
} from "../lib/units";
import type { AppSettings, WatchState } from "../lib/settings";
import { watchedPlaces, watchesAnything } from "../lib/settings";
import { useOfflineSince } from "../hooks/useOffline";
import type { UndoableRemoval } from "../components/ToastHost";
import { formatNumber, useT } from "../i18n";
import { playAlertTone } from "../lib/sound";
import {
  MAX_WATCH_PLACES,
  WATCH_FAILURES_BEFORE_SAYING,
  type WatchHealth,
} from "../lib/watch";
import { APPROACH_MINUTES } from "../lib/approach";
import { LIGHTNING_COUNTS, LIGHTNING_RADII } from "../lib/lightningWatch";
import { ToggleSetting } from "../components/ToggleSetting";
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

interface WatchSectionProps {
  settings: AppSettings;
  onSettings: (next: AppSettings | ((now: AppSettings) => AppSettings)) => void;
  /** Something the reader removed here, and the way back to it. */
  onRemoved: (removal: UndoableRemoval) => void;
  /** Ticks once a minute, so the record on screen notices a row arriving. */
  clock: number;
  onSendWatchTest: () => void;
  /**
   * Whether the watch is still hearing back from the service.
   *
   * The watch is the one thing in the app that runs whether or not anybody
   * is looking, so it is the one thing that has to say when it has stopped.
   */
  watchHealth: WatchHealth;
  /** What Windows has said about notifications, for the line below. */
  notifications?: NotifyPermission;
  onWatchHere: () => void;
  /** Adds the map centre as another watched place. */
  onAddWatchPlace: () => void;
  /** Asks for a sound file of the reader's own, or leaves it as it was. */
  onChooseSound: () => Promise<void>;
}

/**
 * Everywhere the reader says what they want to be told about, and where.
 *
 * The largest section of the settings panel by a distance, and the one that
 * runs whether or not anybody is looking, so it lives in its own file: the
 * places, the radius, the quiet hours, the approach notice, the lightning
 * watch and the sound are all one subject.
 */
export function WatchSection({
  settings,
  onSettings,
  onRemoved,
  clock,
  onSendWatchTest,
  watchHealth,
  notifications,
  onWatchHere,
  onAddWatchPlace,
  onChooseSound,
}: WatchSectionProps) {
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
  // Whether the machine can reach anything at all, which is a different
  // answer from whether a service is answering.
  const offlineSince = useOfflineSince();
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

  return (
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
              style={rangeFill(Math.round(settings.alertVolume * 100), 0, 100)}
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
      <button type="button" className="secondary-button" onClick={onWatchHere}>
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
              <option value="moderate">{t("alerts.severity.moderate")}</option>
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
              <span className="visually-hidden">{t("settings.placeName")}</span>
              <input
                type="text"
                value={place.name}
                maxLength={60}
                aria-label={t("settings.placeName")}
                onChange={(event) =>
                  onSettings({
                    ...settings,
                    watchPlaces: settings.watchPlaces.map((one, at) =>
                      at === index ? { ...one, name: event.target.value } : one,
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
                  <option value="severe">{t("alerts.severity.severe")}</option>
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
  );
}
