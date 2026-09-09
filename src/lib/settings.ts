/**
 * Everything the workspace remembers, and the one name for it.
 *
 * The parts are next door, split on 2026-09-09 because this file had
 * grown to hold the shapes, the defaults, thirty-odd normalisers and the
 * store, and to normalise each section it had to import the module that
 * owns that section's vocabulary. Every one of those leaves therefore had
 * to never import this back, and three did in a week, each of them asking
 * for a type with nowhere else to ask.
 *
 * Each section is normalised beside the vocabulary it is written in now,
 * and the shapes are in `settings/types.ts`, which imports nothing at
 * runtime. This file is what the thirty-six modules that read settings
 * have always named, and it stays that.
 */
export const APP_VERSION = "0.13.0";

export * from "./settings/types";
export * from "./settings/defaults";
export * from "./settings/camera";
export * from "./settings/sections";
export * from "./settings/normalize";
export * from "./settings/restore";
export * from "./settings/store";
