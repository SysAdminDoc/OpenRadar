import {
  Database,
  Download,
  MapPinned,
  Pause,
  Play,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatNumber, useT, type StringKey } from "../i18n";
import {
  asIncidentPackReference,
  cancelIncidentPack,
  createIncidentPack,
  deleteIncidentPack,
  estimateIncidentPack,
  formatPackBytes,
  incidentPacksAvailable,
  listIncidentPacks,
  pauseIncidentPack,
  resumeIncidentPack,
  setIncidentPackLimit,
  type IncidentPack,
  type IncidentPackEstimate,
  type IncidentPackLibrary,
  type IncidentPackStatus,
  type PackBounds,
} from "../lib/incidentPacks";
import type { AppSettings } from "../lib/settings";

const EMPTY_LIBRARY: IncidentPackLibrary = {
  packs: [],
  usedBytes: 0,
  diskLimitBytes: 0,
};

const STATUS_KEYS: Record<IncidentPackStatus, StringKey> = {
  queued: "packs.status.queued",
  downloading: "packs.status.downloading",
  paused: "packs.status.paused",
  finalizing: "packs.status.finalizing",
  ready: "packs.status.ready",
  failed: "packs.status.failed",
};

interface IncidentPackManagerProps {
  settings: AppSettings;
  bounds: PackBounds | null;
  onSettings: (settings: AppSettings) => void;
}

/** Keeps ready pack references in settings without ever copying PMTiles data. */
function mergeReadyReferences(
  settings: AppSettings,
  packs: IncidentPack[],
): AppSettings | null {
  const references = [...settings.incidentPacks.references];
  let changed = false;
  for (const pack of packs) {
    const reference = asIncidentPackReference(pack);
    if (!reference) continue;
    const at = references.findIndex((entry) => entry.id === reference.id);
    if (at < 0) {
      references.push(reference);
      changed = true;
    } else if (JSON.stringify(references[at]) !== JSON.stringify(reference)) {
      references[at] = reference;
      changed = true;
    }
  }
  if (!changed) return null;
  return {
    ...settings,
    incidentPacks: { ...settings.incidentPacks, references },
  };
}

export function IncidentPackManager({
  settings,
  bounds,
  onSettings,
}: IncidentPackManagerProps) {
  const t = useT();
  const available = incidentPacksAvailable();
  const settingsRef = useRef(settings);
  const [library, setLibrary] = useState(EMPTY_LIBRARY);
  const [estimate, setEstimate] = useState<IncidentPackEstimate | null>(null);
  const [name, setName] = useState(t("packs.defaultName"));
  const initialMinZoom = Math.max(
    2,
    Math.min(12, Math.floor(settings.camera.zoom) - 1),
  );
  const [minZoom, setMinZoom] = useState(initialMinZoom);
  const [maxZoom, setMaxZoom] = useState(Math.min(15, initialMinZoom + 4));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const syncReady = useCallback(
    (packs: IncidentPack[]) => {
      const next = mergeReadyReferences(settingsRef.current, packs);
      if (next) onSettings(next);
    },
    [onSettings],
  );

  const refresh = useCallback(async () => {
    if (!available) return EMPTY_LIBRARY;
    const next = await listIncidentPacks();
    setLibrary(next);
    syncReady(next.packs);
    return next;
  }, [available, syncReady]);

  useEffect(() => {
    if (!available) return;
    let open = true;
    let timer = 0;
    const poll = async () => {
      try {
        const next = await refresh();
        if (!open) return;
        const active = next.packs.some((pack) =>
          ["queued", "downloading", "finalizing"].includes(pack.status),
        );
        timer = window.setTimeout(poll, active ? 650 : 1000);
      } catch (failure) {
        if (!open) return;
        setError(failure instanceof Error ? failure.message : String(failure));
        timer = window.setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => {
      open = false;
      window.clearTimeout(timer);
    };
  }, [available, refresh]);

  useEffect(() => {
    if (!available) return;
    void setIncidentPackLimit(settings.incidentPacks.diskLimitMb)
      .then((next) => setLibrary(next))
      .catch((failure) =>
        setError(failure instanceof Error ? failure.message : String(failure)),
      );
  }, [available, settings.incidentPacks.diskLimitMb]);

  useEffect(() => {
    let open = true;
    const timer = window.setTimeout(() => {
      if (!available || !bounds || minZoom > maxZoom) {
        setEstimate(null);
        return;
      }
      void estimateIncidentPack({ bounds, minZoom, maxZoom })
        .then((next) => {
          if (!open) return;
          setEstimate(next);
          setError(null);
        })
        .catch((failure) => {
          if (!open) return;
          setEstimate(null);
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
        });
    }, 180);
    return () => {
      open = false;
      window.clearTimeout(timer);
    };
  }, [available, bounds, maxZoom, minZoom]);

  const act = useCallback(
    async (key: string, action: () => Promise<unknown>, done: string) => {
      setBusy(key);
      setError(null);
      setNotice(null);
      try {
        await action();
        await refresh();
        setNotice(done);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const create = () => {
    if (!bounds || !estimate?.fits || !name.trim()) return;
    void act(
      "create",
      () => createIncidentPack({ name, bounds, minZoom, maxZoom }),
      t("packs.started"),
    );
  };

  const removeReference = (id: string) => {
    const current = settingsRef.current;
    onSettings({
      ...current,
      incidentPacks: {
        ...current.incidentPacks,
        selectedId:
          current.incidentPacks.selectedId === id
            ? null
            : current.incidentPacks.selectedId,
        references: current.incidentPacks.references.filter(
          (reference) => reference.id !== id,
        ),
      },
    });
  };

  const discard = (pack: IncidentPack, cancel: boolean) => {
    removeReference(pack.id);
    void act(
      pack.id,
      () =>
        cancel ? cancelIncidentPack(pack.id) : deleteIncidentPack(pack.id),
      cancel ? t("packs.cancelled") : t("packs.deleted"),
    );
  };

  const select = (pack: IncidentPack) => {
    const reference = asIncidentPackReference(pack);
    if (!reference) return;
    const current = settingsRef.current;
    const references = current.incidentPacks.references.filter(
      (entry) => entry.id !== reference.id,
    );
    references.push(reference);
    onSettings({
      ...current,
      projection: "mercator",
      camera: {
        ...current.camera,
        center: [
          (reference.bounds.west + reference.bounds.east) / 2,
          (reference.bounds.south + reference.bounds.north) / 2,
        ],
        zoom: Math.min(reference.maxZoom, reference.minZoom + 1),
        pitch: 0,
      },
      incidentPacks: {
        ...current.incidentPacks,
        selectedId: reference.id,
        references,
      },
    });
    setNotice(t("packs.selected", { name: pack.name }));
  };

  const selected = settings.incidentPacks.selectedId;
  const nativeIds = useMemo(
    () => new Set(library.packs.map((pack) => pack.id)),
    [library.packs],
  );
  const missing = settings.incidentPacks.references.filter(
    (reference) => !nativeIds.has(reference.id),
  );

  return (
    <div className="settings-section incident-packs" data-incident-packs>
      <div className="settings-section__title">
        <span>{t("packs.title")}</span>
        <small>{t("packs.format")}</small>
      </div>
      <p className="source-note">{t("packs.detail")}</p>

      {!available ? (
        <p className="empty-copy">{t("packs.desktopOnly")}</p>
      ) : (
        <>
          <label className="range-row incident-packs__ceiling">
            <span>
              <strong>{t("packs.ceiling")}</strong>
              <small>
                {t("packs.used", {
                  used: formatPackBytes(library.usedBytes),
                  limit: formatPackBytes(
                    settings.incidentPacks.diskLimitMb * 1024 * 1024,
                  ),
                })}
              </small>
            </span>
            <input
              type="range"
              min={256}
              max={32_768}
              step={256}
              value={settings.incidentPacks.diskLimitMb}
              aria-label={t("packs.ceiling")}
              onChange={(event) =>
                onSettings({
                  ...settingsRef.current,
                  incidentPacks: {
                    ...settingsRef.current.incidentPacks,
                    diskLimitMb: Number(event.target.value),
                  },
                })
              }
            />
            <output>
              {t("packs.megabytes", {
                count: formatNumber(settings.incidentPacks.diskLimitMb),
              })}
            </output>
          </label>

          <div className="incident-pack-create">
            <label>
              <span>{t("packs.name")}</span>
              <input
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="incident-pack-create__zooms">
              <label>
                <span>{t("packs.minZoom")}</span>
                <input
                  type="number"
                  min={2}
                  max={15}
                  value={minZoom}
                  onChange={(event) =>
                    setMinZoom(
                      Math.max(2, Math.min(15, Number(event.target.value))),
                    )
                  }
                />
              </label>
              <label>
                <span>{t("packs.maxZoom")}</span>
                <input
                  type="number"
                  min={2}
                  max={15}
                  value={maxZoom}
                  onChange={(event) =>
                    setMaxZoom(
                      Math.max(2, Math.min(15, Number(event.target.value))),
                    )
                  }
                />
              </label>
            </div>
            <div className="incident-pack-estimate" aria-live="polite">
              <MapPinned size={15} aria-hidden="true" />
              <span>
                {bounds && estimate
                  ? t("packs.estimate", {
                      // Raw: the sentence chooses its words by this number.
                      count: estimate.tileCount,
                      final: formatPackBytes(estimate.estimatedBytes),
                      temporary: formatPackBytes(estimate.temporaryBytes),
                    })
                  : t("packs.noRegion")}
              </span>
            </div>
            {estimate && !estimate.fits ? (
              <p className="incident-pack-error" role="alert">
                {t("packs.wontFit")}
              </p>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              disabled={
                busy !== null ||
                !bounds ||
                !estimate?.fits ||
                !name.trim() ||
                minZoom > maxZoom
              }
              onClick={create}
            >
              <Download size={16} /> {t("packs.download")}
            </button>
          </div>

          {selected ? (
            <div className="incident-pack-selected">
              <WifiOff size={15} aria-hidden="true" />
              <span>{t("packs.offlineActive")}</span>
              <button
                type="button"
                onClick={() =>
                  onSettings({
                    ...settingsRef.current,
                    incidentPacks: {
                      ...settingsRef.current.incidentPacks,
                      selectedId: null,
                    },
                  })
                }
              >
                <Wifi size={14} /> {t("packs.useOnline")}
              </button>
            </div>
          ) : null}

          <div className="incident-pack-list" role="list">
            {library.packs.length === 0 ? (
              <p className="empty-copy">{t("packs.empty")}</p>
            ) : null}
            {library.packs.map((pack) => {
              const progress = pack.tileCount
                ? Math.round((pack.downloadedTiles / pack.tileCount) * 100)
                : 0;
              const active = ["queued", "downloading", "finalizing"].includes(
                pack.status,
              );
              const canPause = ["queued", "downloading"].includes(pack.status);
              return (
                <article
                  key={pack.id}
                  role="listitem"
                  className={selected === pack.id ? "is-selected" : ""}
                  data-pack-status={pack.status}
                >
                  <div className="incident-pack-list__heading">
                    <span>
                      <Database size={15} aria-hidden="true" />
                      <strong>{pack.name}</strong>
                    </span>
                    <small>{t(STATUS_KEYS[pack.status])}</small>
                  </div>
                  <p>
                    {t("packs.packMeta", {
                      min: pack.minZoom,
                      max: pack.maxZoom,
                      size: formatPackBytes(
                        pack.archiveBytes || pack.downloadedBytes,
                      ),
                    })}
                  </p>
                  {pack.status !== "ready" ? (
                    <label className="incident-pack-progress">
                      <span>
                        {t("packs.progress", {
                          done: formatNumber(pack.downloadedTiles),
                          total: pack.tileCount,
                          percent: progress,
                        })}
                      </span>
                      <progress
                        max={pack.tileCount || 1}
                        value={pack.downloadedTiles}
                      />
                    </label>
                  ) : null}
                  {pack.error ? (
                    <p className="incident-pack-error" role="alert">
                      {pack.error}
                    </p>
                  ) : null}
                  <p className="source-note">{pack.attribution}</p>
                  <div className="incident-pack-actions">
                    {pack.status === "ready" ? (
                      <button
                        type="button"
                        className={selected === pack.id ? "is-active" : ""}
                        aria-pressed={selected === pack.id}
                        onClick={() => select(pack)}
                      >
                        <MapPinned size={14} /> {t("packs.usePack")}
                      </button>
                    ) : null}
                    {canPause ? (
                      <button
                        type="button"
                        disabled={busy === pack.id}
                        onClick={() =>
                          void act(
                            pack.id,
                            () => pauseIncidentPack(pack.id),
                            t("packs.paused"),
                          )
                        }
                      >
                        <Pause size={14} /> {t("packs.pause")}
                      </button>
                    ) : null}
                    {pack.status === "paused" || pack.status === "failed" ? (
                      <button
                        type="button"
                        disabled={busy === pack.id}
                        onClick={() =>
                          void act(
                            pack.id,
                            () => resumeIncidentPack(pack.id),
                            t("packs.resumed"),
                          )
                        }
                      >
                        <Play size={14} /> {t("packs.resume")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy === pack.id}
                      onClick={() => discard(pack, active)}
                    >
                      {active ? <X size={14} /> : <Trash2 size={14} />}
                      {active ? t("packs.cancel") : t("packs.delete")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {missing.map((reference) => (
            <div className="incident-pack-missing" key={reference.id}>
              <span>
                <strong>{reference.name}</strong>
                <small>{t("packs.missing")}</small>
              </span>
              <button
                type="button"
                onClick={() => removeReference(reference.id)}
              >
                <Trash2 size={14} /> {t("packs.forget")}
              </button>
            </div>
          ))}
        </>
      )}

      {notice ? (
        <p className="incident-pack-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="incident-pack-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
