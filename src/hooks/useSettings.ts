import { useCallback, useEffect, useRef, useState } from "react";
import { setLanguage } from "../i18n";
import { setClockZone, setUnits } from "../lib/units";
import {
  DEFAULT_SETTINGS,
  cameraFromSearch,
  loadSettings,
  normalizeSettings,
  saveSettings,
  type AppSettings,
  type CameraState,
  type ProjectionMode,
} from "../lib/settings";

/** Camera moves arrive in bursts, so the file is written once the map settles. */
const CAMERA_SAVE_DELAY_MS = 450;

export interface SettingsState {
  settings: AppSettings;
  /** True once the stored file has been read and any shared view applied. */
  hydrated: boolean;
  /** The newest settings, readable from a callback without a stale closure. */
  settingsRef: { readonly current: AppSettings };
  applySettings: (next: AppSettings) => void;
  updateCamera: (camera: CameraState) => void;
}

export function useSettings(options: {
  onPersistError: () => void;
}): SettingsState {
  const { onPersistError } = options;
  const [settings, setSettings] = useState<AppSettings>(() =>
    normalizeSettings(DEFAULT_SETTINGS),
  );
  const [hydrated, setHydrated] = useState(false);
  const settingsRef = useRef(settings);
  const saveTimerRef = useRef<number | null>(null);
  const persistErrorRef = useRef(onPersistError);

  useEffect(() => {
    persistErrorRef.current = onPersistError;
  }, [onPersistError]);

  const persist = useCallback((next: AppSettings) => {
    void saveSettings(next).catch(() => persistErrorRef.current());
  }, []);

  const applySettings = useCallback(
    (next: AppSettings) => {
      const normalized = normalizeSettings(next);
      settingsRef.current = normalized;
      setSettings(normalized);
      persist(normalized);
    },
    [persist],
  );

  const updateCamera = useCallback(
    (camera: CameraState) => {
      const next = normalizeSettings({ ...settingsRef.current, camera });
      settingsRef.current = next;
      setSettings(next);
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(
        () => persist(next),
        CAMERA_SAVE_DELAY_MS,
      );
    },
    [persist],
  );

  useEffect(() => {
    let active = true;
    void loadSettings().then((stored) => {
      if (!active) return;
      // A shared view in the address bar wins over what was last saved.
      const params = new URLSearchParams(window.location.search);
      const projection: ProjectionMode =
        params.get("projection") === "globe" ? "globe" : stored.projection;
      const next = normalizeSettings({
        ...stored,
        projection,
        camera: cameraFromSearch(window.location.search, stored.camera),
      });
      settingsRef.current = next;
      setSettings(next);
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // The language store is external state the whole tree reads, kept in step
  // with the setting the same way the theme attribute is.
  useEffect(() => {
    setLanguage(settings.language);
    // The pseudolocale is not a language anyone speaks, so the document keeps
    // saying English: a screen reader should not try to pronounce it.
    document.documentElement.lang =
      settings.language === "pseudo" ? "en" : settings.language;
  }, [settings.language]);

  // The same shape as the language store: external state the whole tree reads
  // through a hook, kept in step with the setting.
  useEffect(() => {
    setUnits(settings.units);
  }, [settings.units]);

  useEffect(() => {
    setClockZone(settings.clock);
  }, [settings.clock]);

  useEffect(() => {
    // Everything in the workspace is sized from the root, so one variable
    // moves all of it and nothing has to be measured twice.
    document.documentElement.style.setProperty(
      "--text-scale",
      String(settings.textScale / 100),
    );
  }, [settings.textScale]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    meta?.setAttribute(
      "content",
      settings.theme === "dark" ? "#090b10" : "#eef2f6",
    );
  }, [settings.theme]);

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    },
    [],
  );

  return { settings, hydrated, settingsRef, applySettings, updateCamera };
}
