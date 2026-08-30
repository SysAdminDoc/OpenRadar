import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { PanelShell } from "./PanelShell";
import {
  allCommands,
  searchCommands,
  type Command,
  type CommandAction,
} from "../lib/commands";
import type { AppSettings } from "../lib/settings";

interface CommandPaletteProps {
  settings: AppSettings;
  /** Runs the command and decides what the palette should do next. */
  onRun: (action: CommandAction) => void;
  onClose: () => void;
}

/** Which of the switches a command drives is currently on. */
function isOn(settings: AppSettings, command: Command): boolean | null {
  switch (command.action.kind) {
    case "layer":
      return settings.layers[command.action.layer];
    case "style":
      return settings.mapStyle === command.action.style;
    case "product":
      return settings.radar.product === command.action.product;
    default:
      return null;
  }
}

/**
 * Every layer, product, map type, panel, and tool in one list you can type at.
 * The project has no keyboard shortcuts, so it is a button on the command bar
 * rather than something you have to know about to find.
 */
export function CommandPalette({
  settings,
  onRun,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const commands = useMemo(() => allCommands(), []);
  const results = useMemo(
    () => searchCommands(commands, query),
    [commands, query],
  );

  return (
    <PanelShell
      eyebrow="Everything, in one list"
      title="Commands"
      onClose={onClose}
      className="surface-panel--left"
    >
      <label className="search-field">
        <Search size={17} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try meso, hail, or export"
          autoComplete="off"
          aria-label="Search every layer, product, and panel"
        />
      </label>

      <div className="result-list" data-command-count={results.length}>
        {results.map((command) => {
          const on = isOn(settings, command);
          return (
            <button
              type="button"
              className="result-row"
              key={command.id}
              data-command={command.id}
              aria-pressed={on === null ? undefined : on}
              // Closing is left to whoever runs it: a command that opens a
              // panel has to leave that panel open, and closing here would
              // shut it again the moment it appeared.
              onClick={() => onRun(command.action)}
            >
              <span>
                <strong>{command.label}</strong>
                <small>
                  {command.group}
                  {on === null ? "" : on ? " · on" : " · off"}
                </small>
              </span>
            </button>
          );
        })}
        {query.trim() && !results.length ? (
          <p className="empty-copy">
            Nothing here matches that. Try a shorter word.
          </p>
        ) : null}
      </div>
    </PanelShell>
  );
}
