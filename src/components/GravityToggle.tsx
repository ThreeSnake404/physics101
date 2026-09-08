type GravityToggleProps = {
  enabled: boolean;
  disabled?: boolean;
  onToggle: () => void;
};

export function GravityToggle({ enabled, disabled, onToggle }: GravityToggleProps) {
  return (
    <button
      type="button"
      className={`gravity-toggle${enabled ? " is-on" : ""}`}
      disabled={disabled}
      onClick={onToggle}
      aria-pressed={enabled}
    >
      Gravity {enabled ? "On" : "Off"}
    </button>
  );
}
