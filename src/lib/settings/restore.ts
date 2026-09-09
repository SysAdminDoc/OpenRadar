/**
 * A settings file handed back in, and what could not be read out of it.
 */
import { SCHEMA_VERSION, type AppSettings } from "./types";
import { DEFAULT_SETTINGS } from "./defaults";
import { normalizeSettings } from "./normalize";
import { THEME_TOKENS } from "../theme";

/** What came back from a settings file, and what did not. */
export interface RestoredSettings {
  settings: AppSettings;
  /**
   * The file was written by a build with a newer shape than this one, so
   * anything that changed meaning has been read as this build understands it.
   */
  fromNewerBuild: boolean;
  /**
   * Keys the file carried that this build does not read. Either they belong to
   * a newer version or the file was hand-edited.
   */
  unread: string[];
}

/**
 * Reads a settings file and says what it could not take.
 *
 * Restoring used to report the same sentence whatever happened, which on a
 * file from a newer build meant claiming everything was in place while
 * quietly dropping the parts this build has no idea about.
 */
export function restoreSettings(value: unknown): RestoredSettings {
  const settings = normalizeSettings(value);
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const version = raw.schemaVersion;
  const known = new Set(Object.keys(DEFAULT_SETTINGS));
  const unread = Object.keys(raw)
    .filter((key) => !known.has(key))
    .sort();
  const nested = (
    candidate: unknown,
    expected: readonly string[],
    prefix: string,
  ) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return;
    }
    const keys = new Set(expected);
    unread.push(
      ...Object.keys(candidate as Record<string, unknown>)
        .filter((key) => !keys.has(key))
        .map((key) => `${prefix}.${key}`),
    );
  };

  nested(raw.camera, Object.keys(DEFAULT_SETTINGS.camera), "camera");
  nested(raw.radar, Object.keys(DEFAULT_SETTINGS.radar), "radar");
  nested(raw.layers, Object.keys(DEFAULT_SETTINGS.layers), "layers");
  // `name` is optional, so it is not a key of the default and has to be
  // named here or a backup carrying one reports it as a key this build did
  // not read.
  nested(raw.occasions, Object.keys(DEFAULT_SETTINGS.occasions), "occasions");
  nested(raw.watch, [...Object.keys(DEFAULT_SETTINGS.watch), "name"], "watch");
  nested(
    raw.incidentPacks,
    Object.keys(DEFAULT_SETTINGS.incidentPacks),
    "incidentPacks",
  );
  const radar = raw.radar as Record<string, unknown> | undefined;
  nested(radar?.stormMotion, ["speedMs", "fromDegrees"], "radar.stormMotion");
  // A theme is checked to its own tokens too, the way a palette's stops are:
  // a directive this build has never heard of is dropped by the parser, and
  // dropping it silently is how a reader restores a file and cannot see what
  // did not come back. A value that is not a theme at all is reported as one
  // key rather than inspected, since there is nothing inside it to inspect.
  const storedTheme = raw.workspaceTheme;
  const themeIsRecord =
    !!storedTheme &&
    typeof storedTheme === "object" &&
    !Array.isArray(storedTheme);
  // Null is the value for "no theme" rather than a value nobody could read.
  if (storedTheme !== undefined && storedTheme !== null && !themeIsRecord) {
    unread.push("workspaceTheme");
  } else {
    nested(storedTheme, ["name", "base", "tokens"], "workspaceTheme");
    nested(
      (storedTheme as Record<string, unknown> | undefined)?.tokens,
      THEME_TOKENS.map((token) => token.directive),
      "workspaceTheme.tokens",
    );
  }
  nested(
    raw.palette,
    ["name", "product", "units", "step", "stops", "rangeFolded", "skipped"],
    "palette",
  );
  const palette = raw.palette as Record<string, unknown> | undefined;
  if (Array.isArray(palette?.stops)) {
    palette.stops.forEach((stop, index) =>
      nested(
        stop,
        ["value", "color", "solid", "toColor"],
        `palette.stops.${index}`,
      ),
    );
  }
  if (Array.isArray(raw.presets)) {
    raw.presets.forEach((preset, index) => {
      nested(
        preset,
        ["name", "camera", "projection", "mapStyle"],
        `presets.${index}`,
      );
      const record = preset as Record<string, unknown> | null;
      nested(
        record?.camera,
        Object.keys(DEFAULT_SETTINGS.camera),
        `presets.${index}.camera`,
      );
    });
  }
  const incidentPacks = raw.incidentPacks as
    Record<string, unknown> | undefined;
  if (Array.isArray(incidentPacks?.references)) {
    incidentPacks.references.forEach((reference, index) => {
      nested(
        reference,
        [
          "id",
          "name",
          "bounds",
          "minZoom",
          "maxZoom",
          "bytes",
          "sha256",
          "attribution",
        ],
        `incidentPacks.references.${index}`,
      );
      const record = reference as Record<string, unknown> | null;
      nested(
        record?.bounds,
        ["west", "south", "east", "north"],
        `incidentPacks.references.${index}.bounds`,
      );
    });
  }
  return {
    settings,
    fromNewerBuild: typeof version === "number" && version > SCHEMA_VERSION,
    unread: [...new Set(unread)].sort(),
  };
}
