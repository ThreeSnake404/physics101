import type { PresetViewName } from "../scene/types";

type ViewControlsProps = {
  disabled?: boolean;
  isOrtho: boolean;
  activeView: PresetViewName | null;
  onFront: () => void;
  onTop: () => void;
  onRight: () => void;
  onToggleOrtho: () => void;
};

export function ViewControls({
  disabled = false,
  isOrtho,
  activeView,
  onFront,
  onTop,
  onRight,
  onToggleOrtho,
}: ViewControlsProps) {
  return (
    <div className="view-controls" role="group" aria-label="Camera Views">
      <button
        type="button"
        className={`view-btn${activeView === "front" ? " is-active" : ""}`}
        disabled={disabled}
        onClick={onFront}
        title="Front view — Z axis points at screen (Numpad 1)"
      >
        Front
      </button>
      <button
        type="button"
        className={`view-btn${activeView === "top" ? " is-active" : ""}`}
        disabled={disabled}
        onClick={onTop}
        title="Top view — Y axis points at screen (Numpad 7)"
      >
        Top
      </button>
      <button
        type="button"
        className={`view-btn${activeView === "right" ? " is-active" : ""}`}
        disabled={disabled}
        onClick={onRight}
        title="Right view — X axis points at screen (Numpad 3)"
      >
        Right
      </button>
      <button
        type="button"
        className={`view-btn${isOrtho ? " is-active" : ""}`}
        disabled={disabled}
        onClick={onToggleOrtho}
        title="Toggle Orthographic / Perspective view (Numpad 5)"
        aria-pressed={isOrtho}
      >
        Ortho/Persp
      </button>
    </div>
  );
}
