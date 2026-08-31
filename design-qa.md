# Design QA

## Evidence

- Reference: `docs/mockups/openradar-incident-rail.png`
- Surface board: `docs/mockups/openradar-surface-board.png`
- Implementation: `assets/screenshots/openradar-main.png`
- Full comparison: `artifacts/design-qa/comparison-alerts-final.png`
- Viewport: 1487 by 1058 CSS pixels at 1:1 scale
- State: dark theme, live radar, Alerts open

## Comparison history

### Pass 1

The workspace structure matched, but the side panel and brand block were too wide. The command rail also exposed too many controls at once. These were P1 proportion and hierarchy findings.

### Pass 2

Panel width, brand width, and command grouping were tightened. A P2 narrow-layout conflict remained because the new rail overrode existing label-hiding rules. Product copy also appeared twice in the accessibility tree.

### Final pass

The narrow rules now hold, product copy has one source of truth, the live control no longer collides with the frame slider, and light and increased-contrast themes pass automated checks. No actionable P0, P1, or P2 visual findings remain. Live geography and alert content differ from the reference because the implementation uses current provider data.

## Surface coverage

Search, Map Type, Layers, Alerts, Tropical, History, Route, Guidance, Tides, Export, Upload, Forecast, Settings, and Diagnostics were opened and inspected. Left and right panel docking, map control clearance, panel scrolling, footer controls, and page overflow were checked at 1487 by 1058 and 1024 by 720.

## Fidelity checks

- Typography: compact sans-serif hierarchy matches the reference without clipping.
- Spacing: fixed 56-pixel header, 68-pixel rail, docked panel, and 88-pixel playback band share edges.
- Colour: graphite surfaces, cyan navigation, green live state, and alert severity accents match the reference system.
- Assets: existing map imagery and Lucide icons remain sharp. No substitute artwork or placeholder controls were introduced.
- Content: every existing page remains reachable. Labels stay localized in English and Spanish.
- Responsive and accessible behavior: desktop and compact projects pass keyboard, text scale, pseudolocale, light theme, increased contrast, and axe checks.

final result: passed
