# OpenRadar Design QA

## Capture contract

- Reference: `C:\Users\--\Documents\myradar-audit\04_screens\086_clean_relaunch_recovery\client.png`
- Reference size: 1920 by 1009 pixels
- Implementation size: 1920 by 1009 CSS pixels at device scale 1
- State: dark map, flat projection, default camera, live radar visible, timeline paused
- Full comparison: `artifacts/design-qa/comparison-final.png`
- Bottom chrome comparison: `artifacts/design-qa/bottom-comparison-final.png`
- Final application capture: `artifacts/design-qa/implementation-final.png`

## Pass history

### Pass 1

- P1: The camera opened on the whole world instead of the Gulf, Caribbean, and southern United States. The default camera now opens at longitude -85.5, latitude 25.5, and zoom 4.55.
- P1: A top status and brand overlay covered map content that was clear in the reference. It was removed.
- P2: The radar legend and timeline were too wide and too far apart. Both were compacted and aligned over the center of the command bar.
- P2: The command bar was taller and darker than the reference. Its height, button density, icon size, and surface color were corrected.
- P2: The cursor readout collided with attribution. It now appears only while the pointer is over the map and leaves room for source credits.

### Pass 2

- P1: Rapid 256 pixel radar tile requests could exceed the provider budget and leave a blank radar frame. The source now uses 512 pixel tiles, pauses while the window is hidden, and retains a lower request rate.
- P2: A missing basemap sprite produced a browser warning. A transparent fallback image resolver now handles absent optional sprites without warnings.
- P2: The projection command was labeled Presets even though it changed the globe mode. It now reads Globe or Flat to match the action.

### Final verification

- P0: none
- P1: none
- P2: none
- Typography: compact system text, hierarchy, and muted map chrome match the reference density.
- Spacing: bottom controls stay aligned, clear the attribution, and remain usable from 1024 pixels wide.
- Color: the dark neutral command surface, cyan controls, and radar palette are consistent across the map and panels.
- Imagery: the implementation uses live radar tiles and an original application icon. No screenshot pixels or proprietary map art are bundled.
- Copy: labels describe their actions and stale radar frames show their age.
- Interaction: pan, zoom, projection changes, radar scrubbing, restart persistence, panels, presets, dual pane, drawing tools, and theme changes were exercised.
- Browser diagnostics: no warnings or errors in the final verification tab.

final result: passed
