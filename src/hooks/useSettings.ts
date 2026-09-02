import { useCallback, useEffect, useRef, useState } from "react";
import { ensureLanguage, setLanguage } from "../i18n";
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

/**
 * The widths the stylesheet changes the layout at, matching the
 * `[data-narrow]` rules in index.css. Kept here because script is the only
 * place that can divide the viewport by the text scale.
 */
const LAYOUT_WIDTHS = [1320, 980, 680] as const;

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
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
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
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        persist(settingsRef.current);
      }, CAMERA_SAVE_DELAY_MS);
    },
    [persist],
  );

  useEffect(() => {
    let active = true;
    void loadSettings().then(async (stored) => {
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
      // Apply the saved language before the loading screen gives way to the
      // workspace. Otherwise the first screen after launch is always English.
      // Spanish is fetched here rather than after the workspace is up, which
      // is the difference between a Spanish first screen and an English one
      // that turns Spanish a moment later.
      await ensureLanguage(next.language);
      if (!active) return;
      setLanguage(next.language);
      document.documentElement.lang =
        next.language === "pseudo" ? "en" : next.language;
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
    // Which of the layout's three widths the workspace is under. A media query
    // reads the real viewport and knows nothing about the whole thing being
    // drawn at 130 percent, so at that size a wide screen kept a wide layout
    // in a space a third smaller than the query thought it was.
    const measure = () => {
      const width = window.innerWidth / (settings.textScale / 100);
      const under = LAYOUT_WIDTHS.filter((edge) => width <= edge);
      const root = document.documentElement;
      if (under.length) root.dataset.narrow = under.join(" ");
      else delete root.dataset.narrow;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [settings.textScale]);

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
