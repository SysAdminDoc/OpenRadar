import type { AppSettings, LayerSettings } from "../lib/settings";
import { APP_VERSION } from "../lib/settings";
import { COUNTY_VINTAGE } from "../lib/counties";
import { LAYER_SOURCES, layerProvenance } from "../lib/layerProvenance";
import { OVERLAY_ADAPTERS } from "../lib/overlays";
import { dataExportAvailable, exportGridData } from "../lib/dataExport";
import { diagnosticsBlock, issueUrl } from "../lib/diagnostics";
import { domainFor } from "../lib/providers/mrms";
import { gpuSupport } from "../lib/gpu";
import { isTdwrStation } from "../lib/radarKinds";
import { mrmsTimeFor, useMrmsOverlays } from "./useMrmsOverlays";
import {
  overlayProvenance,
  timelineProvenance,
  type Provenance,
} from "../lib/provenance";
import { providerIncidents } from "../lib/providers";
import { translate, type StringKey } from "../i18n";
import { type DataExportSource } from "./useExport";
import { type NotifyPermission } from "../lib/notify";
import { type RadarFrame } from "../lib/radar";
import { useCallback, useMemo } from "react";
import { useClassification } from "./useClassification";
import { useForecastSmoke } from "./useForecastSmoke";
import { useSnowfall } from "./useSnowfall";
import { useLightning } from "./useLightning";
import { useRadarTimeline } from "./useRadarTimeline";
import { useSingleSiteRadar } from "./useSingleSiteRadar";
import { useWind } from "./useWind";
import { useWorkspaceOverlays } from "./useWorkspaceOverlays";

import type { ProviderHealth } from "../lib/providers/health";
import type { LogEntry } from "../lib/log";
import type { CrashRecord } from "../lib/crashReport";
import type { ToastMessage } from "../components/ToastHost";
import type { MrmsChoices } from "./useMrmsOverlays";

/**
 * The layer switches whose records come from the overlay adapters instead.
 *
 * Both lists are complete, so anything here would otherwise be reported twice
 * under two slightly different names.
 */
const COVERED_BY_ADAPTERS = new Set(
  OVERLAY_ADAPTERS.map((adapter) => adapter.id as string),
);

/**
 * What the workspace can say about itself.
 *
 * Three questions with one subject: which of the things on screen have
 * numbers behind them that a reader can take away, which layers are actually
 * drawn and where each of them came from, and what goes in the block
 * somebody pastes when the app is doing the wrong thing.
 *
 * They travelled together in `App.tsx` and they belong together: the export
 * offers and the provenance list are both read by the diagnostics block, and
 * the provenance list is read by an exported picture as well, so a record
 * that drifts drifts on the one artefact that leaves the machine.
 */
export interface WorkspaceReportOptions {
  frames: RadarFrame[];
  frameIndex: number;
  singleSite: ReturnType<typeof useSingleSiteRadar>;
  mrms: ReturnType<typeof useMrmsOverlays>;
  mrmsChoices: MrmsChoices;
  overlays: ReturnType<typeof useWorkspaceOverlays>;
  settings: AppSettings;
  classification: ReturnType<typeof useClassification>;
  forecastSmoke: ReturnType<typeof useForecastSmoke>;
  /**
   * The picture the map is laying over the ground, or null when the model
   * has nothing for the hour on the playhead. Only its presence is read
   * here: a layer drawing nothing has no record.
   */
  drawnForecastSmoke: unknown;
  snowfall: ReturnType<typeof useSnowfall>;
  lightning: ReturnType<typeof useLightning>;
  wind: ReturnType<typeof useWind>;
  countiesDrawn: boolean;
  timeline: ReturnType<typeof useRadarTimeline>;
  health: ProviderHealth[];
  logEntries: LogEntry[];
  mapStatus: "loading" | "ready" | "error" | "nogpu";
  notifications: NotifyPermission;
  autostart: { on: boolean | null };
  lastCrash: CrashRecord | null;
  lastWebviewCrash: CrashRecord | null;
  webviewRuntime: string | null | undefined;
  settingsRef: { current: AppSettings };
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
  t: (key: StringKey, params?: Record<string, string | number>) => string;
}

export function useWorkspaceReport({
  frames,
  frameIndex,
  singleSite,
  mrms,
  mrmsChoices,
  overlays,
  settings,
  classification,
  forecastSmoke,
  drawnForecastSmoke,
  snowfall,
  lightning,
  wind,
  countiesDrawn,
  timeline,
  health,
  logEntries,
  mapStatus,
  notifications,
  autostart,
  lastCrash,
  lastWebviewCrash,
  webviewRuntime,
  settingsRef,
  pushToast,
  t,
}: WorkspaceReportOptions) {
  // What is drawn right now that has numbers behind it: the sweep, and every
  // grid on the map. A grid is cut to the view rather than written whole,
  // because the whole of one is a continent and nobody asked for a continent.
  const dataSources = useMemo(() => {
    if (!dataExportAvailable()) return [];
    const offers: DataExportSource[] = [];
    if (singleSite.exportValues) {
      const write = singleSite.exportValues;
      offers.push({
        id: "sweep",
        label: singleSite.sweep?.product ?? t("export.dataRadar"),
        // Named for the sweep on screen, and the hook sends that sweep's own
        // product rather than the setting, so a switch still in flight cannot
        // label one product and write another.
        format: "csv",
        // A sweep is a fan around its site rather than a rectangle, so the
        // view has nothing to say about which gates are in it.
        run: () => write(),
      });
    }
    // The object the picture was decoded from, beside the readings taken out
    // of it. A CSV is this app's account of the volume; the volume is what
    // another tool reopens, and it is the same file the bucket published.
    if (singleSite.saveVolume) {
      const save = singleSite.saveVolume;
      offers.push({
        id: "volume",
        label: t("export.dataVolume"),
        // From the sweep rather than from the site the map is parked on. The
        // two differ while a reader looks at an archive volume from somewhere
        // else, and the native side names the file from the sweep: reading
        // the map's station put `nids` on a button that writes an `.ar2v`.
        format: isTdwrStation(singleSite.sweep?.station ?? null)
          ? "nids"
          : "ar2v",
        // Nothing is read out of it, so the toast says its size rather than
        // counting readings that were never taken.
        verbatim: true,
        run: () => save(),
      });
    }
    // The picture on the map is a grid too when MRMS is drawing it, and it is
    // the one a reader is most likely to want the numbers behind.
    const frame = frames[frameIndex];
    if (frame?.providerId === "mrms") {
      offers.push({
        id: "grid:composite",
        label: t("export.dataComposite"),
        format: "tif",
        run: (view) =>
          view
            ? exportGridData({
                product: "composite",
                time: frame.time,
                domain:
                  domainFor([
                    (view.west + view.east) / 2,
                    (view.south + view.north) / 2,
                  ])?.id ?? null,
                west: view.west,
                south: view.south,
                east: view.east,
                north: view.north,
              })
            : Promise.reject(new Error(t("export.dataNoView"))),
      });
    }
    for (const layer of mrms.layers) {
      offers.push({
        id: `grid:${layer.product}`,
        label: t(layer.labelKey),
        format: "tif",
        // Cut to the view at the moment the button is pressed. The whole of
        // one of these grids is a continent, and nobody asked for a continent.
        run: (view) =>
          view
            ? exportGridData({
                product: layer.product,
                time: layer.time,
                west: view.west,
                south: view.south,
                east: view.east,
                north: view.north,
              })
            : Promise.reject(new Error(t("export.dataNoView"))),
      });
    }
    return offers;
    // Through `t` rather than the module's own translate, so the list is
    // built again when the language changes: it is built once otherwise, and
    // a switch mid-session left these labels in the language before it.
  }, [
    frameIndex,
    frames,
    mrms.layers,
    singleSite.exportValues,
    singleSite.saveVolume,
    singleSite.sweep?.product,
    singleSite.sweep?.station,
    t,
  ]);

  /**
   * Every layer drawn over the radar right now, each saying where it came
   * from and what it claims.
   *
   * Only what is both switched on and holding data, because a record for
   * something the reader cannot see would describe a different picture from
   * the one they are looking at.
   *
   * Two surfaces need this and only the diagnostics block had it. An
   * exported picture credits the basemap and the radar out of its own
   * records, so one made with the warnings, the outlooks or the smoke
   * analysis over the radar said nothing about any of them, on the one
   * artefact that leaves the machine and reaches somebody who cannot check
   * it. The map's own attribution control has always credited them, which is
   * what made that easy to miss.
   *
   * The radar frame is not in here. Diagnostics puts its own in front of
   * these and an export already carries one record per frame.
   */
  const drawnOverlays = useCallback(
    (now: number): Provenance[] => {
      const layers: Provenance[] = [];
      for (const adapter of OVERLAY_ADAPTERS) {
        const state = overlays.states[adapter.id];
        if (!overlays.data[adapter.id] || !state?.fetchedAt) continue;
        // The analysis comes off the map while the model's smoke has it, and
        // a record of a layer that is not drawn describes a picture the
        // reader cannot see.
        if (adapter.id === "smoke" && drawnForecastSmoke) continue;
        // The adapter knows how to fetch itself; the table knows what kind of
        // statement it makes, and three of these are forecasts rather than
        // observations.
        const described = Object.values(LAYER_SOURCES).find(
          (source) => source.sourceId === adapter.id,
        );
        layers.push(
          overlayProvenance({
            adapter,
            fetchedAt: state.fetchedAt,
            kind: described?.kind,
            // A derived layer has to say what was done to it, and the ledger
            // beside the switch is where that sentence is written. Leaving it
            // behind made the record malformed rather than incomplete, which
            // suppressed the source, the credit and the times as well.
            derivedFrom: described?.derivedFrom,
          }),
        );
      }

      // Everything else the reader can switch on. The overlay adapters above
      // already speak for themselves, so this covers the rest: the locally
      // decoded grids, both lightning layers, wind, satellite, and the two
      // products the radar's own algorithms derive.
      //
      // Each takes the best time the app actually has for it. An MRMS grid knows
      // when it was valid and a lightning window knows when it was observed;
      // where nothing is known the record says it was fetched now, which is true
      // and claims nothing more.

      for (const [key, on] of Object.entries(settings.layers)) {
        // Named rather than `typeof settings.layers`, which reads as a use of
        // the whole settings object and puts it in this callback's
        // dependencies, rebuilding it on every unrelated preference.
        const layer = key as keyof LayerSettings;
        if (!on) continue;
        // Switched on is not the same as drawing. A record for a layer that
        // fetched nothing describes a picture the reader cannot see, which is
        // the opposite of what a report about the picture is for.
        if (layer === "wind" && !wind.field) continue;
        if (layer === "lightningFlashes" && !lightning.window) continue;
        if (layer === "classification" && !classification.report) continue;
        if (layer === "forecastSmoke" && !forecastSmoke.field) continue;
        if (layer === "snowfall" && !snowfall.analysis) continue;
        const source = LAYER_SOURCES[layer];
        // Matched on the source rather than on the switch's own name, because
        // the two do not agree: the alerts adapter is `alerts` and the switch
        // that draws it is `weatherAlerts`. Comparing the names would have let
        // that one layer be reported twice under both.
        if (COVERED_BY_ADAPTERS.has(source.sourceId)) continue;
        // Reference geography with a vintage rather than a moment. Left to
        // fall through it reported the Census boundaries as observed this
        // instant, which is a freshness claim about something that has not
        // moved since 2024.
        if (layer === "counties" && !countiesDrawn) continue;
        const observedAt =
          (layer === "counties" ? COUNTY_VINTAGE : undefined) ??
          // The analysis is what it observed, and it is up to three days
          // back: dated to now it would report snow that fell at the weekend
          // as measured this instant.
          (layer === "snowfall" && snowfall.analysis
            ? Date.parse(snowfall.analysis.valid)
            : undefined) ??
          mrmsTimeFor(mrms.layers, layer, mrmsChoices) ??
          (layer === "lightningFlashes"
            ? // The flash window carries seconds, like the radar frames and
              // unlike everything in a record. Passed straight through it dated
              // every lightning layer to 1970.
              lightning.window
              ? lightning.window.observed * 1000
              : null
            : layer === "classification" && classification.report
              ? Date.parse(classification.report.observed)
              : null);
        // The wind layer is the one forecast here whose run the app already
        // reads, so it can report a real one rather than saying it does not know.
        const modelRun =
          layer === "wind" && wind.field
            ? {
                initUtc: wind.field.init,
                leadMinutes: wind.field.leadHours * 60,
              }
            : layer === "forecastSmoke" && forecastSmoke.field
              ? {
                  initUtc: forecastSmoke.field.init,
                  leadMinutes: forecastSmoke.field.leadHours * 60,
                }
              : undefined;
        // The smoke names the hour it is for; the wind's hour is worked
        // forward from now because the field is the run's own analysis.
        const validAt =
          layer === "forecastSmoke" && forecastSmoke.field
            ? Date.parse(forecastSmoke.field.valid)
            : modelRun
              ? now + modelRun.leadMinutes * 60_000
              : (observedAt ?? now);
        layers.push(
          layerProvenance({
            layer,
            fetchedAt: now,
            observedAt: observedAt ?? now,
            validAt,
            modelRun,
          }),
        );
      }
      return layers;
    },
    [
      classification.report,
      countiesDrawn,
      drawnForecastSmoke,
      forecastSmoke.field,
      lightning.window,
      mrms.layers,
      mrmsChoices,
      overlays.data,
      overlays.states,
      settings.layers,
      snowfall.analysis,
      wind.field,
    ],
  );

  // There is no tracker to round-trip through, so the first message somebody
  // sends about a problem has to carry enough to work with. Everything in the
  // block goes through the redaction: a radar workspace knows where its reader
  // lives to four decimal places, and their account name from every path it
  // has ever logged.
  const copyDiagnostics = useCallback(
    (withPlace: boolean) => {
      const now = Date.now();
      // What is actually on the map right now, each layer saying where it came
      // from and what it claims. Only the frame on screen and the overlays that
      // are both switched on and holding data, because a record for something
      // the reader cannot see would be describing a different picture from the
      // one they are writing about.
      const layers: Provenance[] = [];
      const shown = timelineProvenance({
        frames: timeline.frames,
        frameIndex: timeline.frameIndex,
        provider: timeline.source,
        fetchedAt: timeline.fetchedAt,
        cachedAgeSeconds: timeline.cachedAgeSeconds,
      });
      if (shown) layers.push(shown);
      layers.push(...drawnOverlays(now));
      const packs = settingsRef.current.incidentPacks;
      const block = diagnosticsBlock({
        lastCrash,
        lastWebviewCrash,
        webviewRuntime,
        renderer: gpuSupport().renderer,
        mapReady: mapStatus === "ready",
        radarReady: timeline.frames.length > 0,
        activeSource: timeline.sourceLabel,
        health,
        incidents: providerIncidents(),
        log: logEntries,
        layers,
        now,
        cache: {
          servedAgeSeconds: timeline.cachedAgeSeconds,
          packs: packs.references.length,
          packBytes: packs.references.reduce(
            (total, pack) => total + pack.bytes,
            0,
          ),
          selectedPack: packs.selectedId !== null,
          packLimitMb: packs.diskLimitMb,
        },
        notifications,
        startsWithMachine: autostart.on,
        // Only when the reader ticked the box beside the button, and only when
        // there is a watched place at all.
        place:
          withPlace && settingsRef.current.watch.enabled
            ? {
                label: translate("diagnostics.watchedPlace"),
                longitude: settingsRef.current.watch.center[0],
                latitude: settingsRef.current.watch.center[1],
              }
            : null,
      });
      void (async () => {
        try {
          await navigator.clipboard.writeText(block);
          pushToast({
            title: translate("diagnostics.copied"),
            detail: translate("diagnostics.copiedBody"),
          });
        } catch {
          // A clipboard can be refused: no permission, no focus, no clipboard.
          // Saying where the same text lives is better than saying nothing.
          pushToast({
            title: translate("diagnostics.copyFailed"),
            detail: translate("diagnostics.copyFailedBody"),
          });
        }
      })();
    },
    [
      autostart.on,
      notifications,
      drawnOverlays,
      lastCrash,
      lastWebviewCrash,
      webviewRuntime,
      health,
      logEntries,
      settingsRef,
      mapStatus,
      pushToast,
      timeline,
    ],
  );

  // Copy the block, then open the form. The block goes on the clipboard
  // rather than into the address, because a GitHub issue URL is a GET: its
  // query travels through history and every hop between here and there,
  // and this one would be carrying the renderer, the sources and forty
  // lines of log. It is also far past the length several browsers will
  // open.
  const reportIssue = useCallback(
    (withPlace: boolean) => {
      copyDiagnostics(withPlace);
      void import("@tauri-apps/plugin-opener")
        .then((opener) => opener.openUrl(issueUrl(APP_VERSION)))
        .catch(() => {
          // A build with no bridge to a browser still has the block on the
          // clipboard, which is the half that cannot be done by hand.
          pushToast({
            title: translate("diagnostics.reportFailed"),
            detail: translate("diagnostics.reportFailedDetail"),
          });
        });
    },
    [copyDiagnostics, pushToast],
  );
  return { dataSources, drawnOverlays, copyDiagnostics, reportIssue };
}
