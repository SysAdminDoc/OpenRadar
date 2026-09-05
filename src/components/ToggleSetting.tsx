export interface ToggleSettingProps {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ToggleSetting({
  label,
  detail,
  checked,
  onChange,
}: ToggleSettingProps) {
  return (
    <label className="toggle-row toggle-row--plain">
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i className="toggle-track" aria-hidden="true" />
    </label>
  );
}
