import type { JointControlState } from "../scene/types";

type RotatePartDialogProps = {
  partName: string | null;
  joint: JointControlState | null;
  disabled?: boolean;
  onTargetChange: (angleDeg: number) => void;
};

export function RotatePartDialog({
  partName,
  joint,
  disabled,
  onTargetChange,
}: RotatePartDialogProps) {
  const title = partName ? `Rotate ${partName}` : "Rotate";
  const canDrive = Boolean(partName && joint?.hinged);
  const controlsDisabled = disabled || !canDrive;
  const min = joint?.minDeg ?? -60;
  const max = joint?.maxDeg ?? 60;
  const target = joint?.targetDeg ?? 0;
  const actual = joint?.angleDeg ?? 0;

  return (
    <section className="control-dialog" aria-label={title}>
      <p className="selection-kicker">{title}</p>
      <p className="control-copy">{copyFor(partName, joint)}</p>
      <label className="angle-field">
        <span>Target</span>
        <input
          type="range"
          min={min}
          max={max}
          step={0.5}
          value={clamp(target, min, max)}
          disabled={controlsDisabled}
          onChange={(event) => onTargetChange(Number(event.target.value))}
          aria-label="Joint target angle"
        />
        <div className="angle-range">
          <span>{min.toFixed(0)}°</span>
          <strong>{target.toFixed(1)}°</strong>
          <span>{max.toFixed(0)}°</span>
        </div>
      </label>
      <p className="control-angle">
        Angle <strong>{actual.toFixed(1)}°</strong>
        {canDrive ? (
          <span className={`lock-state${joint?.locked ? " is-locked" : ""}`}>
            {joint?.locked ? "Locked" : "Moving"}
          </span>
        ) : null}
      </p>
    </section>
  );
}

function copyFor(partName: string | null, joint: JointControlState | null) {
  if (!partName) return "Click a part to set its hinge angle.";
  if (!joint?.hinged) return "This part has no hinge yet.";
  return `Servo on ${joint.axisLabel} of the parent. Slide to a pose; the joint drives there, then locks.`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
