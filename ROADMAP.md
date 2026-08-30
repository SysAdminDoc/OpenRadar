# OpenRadar Roadmap

## Next releases

- [ ] Add model guidance, tides, and surge.

## Research-Driven Additions

### P3

- [ ] P3: Spanish localization of the workspace
  Why: StormDeck ships English and Spanish with a pseudolocale gate; a free radar app for the US Gulf and Southwest benefits; all copy is currently inline strings.
  Evidence: StormDeck README "English and Spanish"; ESLint literal-string lint there.
  Touches: new src/i18n/, every panel, Settings language picker.
  Acceptance: switching language updates all panel titles and copy without restart; a pseudolocale run shows no clipped labels at 1024x720.
  Complexity: L
