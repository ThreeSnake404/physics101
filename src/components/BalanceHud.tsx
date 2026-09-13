import type { BalanceState, SteppingPhase } from "../scene/types";

type BalanceHudProps = {
  state: BalanceState;
  gravityEnabled: boolean;
  disabled?: boolean;
  onReset: () => void;
  onStep?: () => void;
};

function phaseLabel(phase: SteppingPhase): string {
  switch (phase) {
    case "shift_weight_right":
      return "1. Shift Chassis (-X)";
    case "lift_left_leg":
      return "2. Lift Left Leg";
    case "swing_left_forward":
      return "3. Swing Left Shoulder (+Z)";
    case "step_down_left":
      return "4. Step Down Left (Plant)";
    case "stabilize_left":
      return "5. Stabilizing (Left Stance)";
    case "shift_weight_left":
      return "6. Shift Chassis (+X)";
    case "lift_right_leg":
      return "7. Lift Right Leg";
    case "swing_right_forward":
      return "8. Swing Right Shoulder (+Z)";
    case "step_down_right":
      return "9. Step Down Right (Plant)";
    case "stabilize_right":
      return "10. Stabilizing (Right Stance)";
    case "grounded":
      return "Chassis Grounded (Halted)";
    case "idle":
    default:
      return "Ready / Monitoring";
  }
}

export function BalanceHud({
  state,
  gravityEnabled,
  disabled,
  onReset,
  onStep,
}: BalanceHudProps) {
  const {
    pitchDeg,
    pitchRateDeg,
    isPitchingForward,
    adjustmentMagnitude,
    chassisGrounded,
    steppingPhase,
    stepCount,
  } = state;

  const isStepping = steppingPhase !== "idle" && steppingPhase !== "grounded";

  const statusLabel = !gravityEnabled
    ? "Standby"
    : chassisGrounded
      ? "Grounded (Halted)"
      : isStepping
        ? "Stepping / Stabilizing"
        : isPitchingForward
          ? "Damping Forward Pitch"
          : "Monitoring (Upright)";

  const statusClass = !gravityEnabled
    ? "status-standby"
    : chassisGrounded
      ? "status-grounded"
      : isStepping
        ? "status-active"
        : isPitchingForward
          ? "status-active"
          : "status-stable";

  return (
    <div className="balance-hud">
      <div className="balance-header">
        <span className="balance-title">Chassis Pitch Controller</span>
        <span className={`balance-badge ${statusClass}`}>{statusLabel}</span>
      </div>

      <div className="balance-metrics">
        <div className="metric-row">
          <span className="metric-label">Gait Phase:</span>
          <span className={`metric-val ${isStepping ? "val-forward" : ""}`}>
            {phaseLabel(steppingPhase)}
          </span>
        </div>
        <div className="metric-row">
          <span className="metric-label">Steps Taken:</span>
          <span className="metric-val">{stepCount}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">Pitch Angle:</span>
          <span className={`metric-val ${pitchDeg > 0.5 ? "val-forward" : ""}`}>
            {pitchDeg >= 0 ? `+${pitchDeg.toFixed(1)}°` : `${pitchDeg.toFixed(1)}°`}
            {pitchDeg > 0.5 ? " (fwd)" : pitchDeg < -0.5 ? " (back)" : ""}
          </span>
        </div>
        <div className="metric-row">
          <span className="metric-label">Pitch Velocity:</span>
          <span className="metric-val">
            {pitchRateDeg >= 0 ? `+${pitchRateDeg.toFixed(1)}°/s` : `${pitchRateDeg.toFixed(1)}°/s`}
          </span>
        </div>
        <div className="metric-row">
          <span className="metric-label">Stabilizing Effort:</span>
          <div className="effort-bar-wrapper">
            <div
              className="effort-bar-fill"
              style={{ width: `${Math.round(adjustmentMagnitude * 100)}%` }}
            />
            <span className="effort-text">{Math.round(adjustmentMagnitude * 100)}%</span>
          </div>
        </div>
      </div>

      <div className="balance-joints-tag">
        <span className={`joint-tag ${isStepping || isPitchingForward ? "tag-active" : ""}`}>
          Shoulders
        </span>
        <span className={`joint-tag ${isStepping || isPitchingForward ? "tag-active" : ""}`}>
          Upper Legs
        </span>
        <span className={`joint-tag ${isStepping || isPitchingForward ? "tag-active" : ""}`}>
          Lower Legs
        </span>
      </div>

      <div className="balance-actions">
        <button
          type="button"
          className="step-btn"
          disabled={disabled || chassisGrounded}
          onClick={onStep}
          title="Trigger a forward stabilizing step cycle (left then right)"
        >
          Take Step
        </button>
        <button
          type="button"
          className="reset-btn"
          disabled={disabled}
          onClick={onReset}
          title="Reset robot to initial standing pose"
        >
          Reset Pose
        </button>
      </div>
    </div>
  );
}
