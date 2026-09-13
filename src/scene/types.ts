export type PresetViewName = "front" | "top" | "right";

export type ViewState = {
  isOrtho: boolean;
  activeView: PresetViewName | null;
};

export type SteppingPhase =
  | "idle"
  | "shift_weight_right"
  | "lift_left_leg"
  | "swing_left_forward"
  | "step_down_left"
  | "stabilize_left"
  | "shift_weight_left"
  | "lift_right_leg"
  | "swing_right_forward"
  | "step_down_right"
  | "stabilize_right"
  | "grounded";

export type BalanceState = {
  active: boolean;
  pitchDeg: number;
  pitchRateDeg: number;
  isPitchingForward: boolean;
  adjustmentMagnitude: number;
  chassisGrounded: boolean;
  status: "idle" | "stabilizing" | "stabilized" | "grounded";
  steppingPhase: SteppingPhase;
  stepCount: number;
};

export type SelectionInfo = {
  name: string;
  x: number;
  y: number;
  z: number;
};

export type JointControlState = {
  name: string;
  angleDeg: number;
  targetDeg: number;
  minDeg: number;
  maxDeg: number;
  axisLabel: string;
  hinged: boolean;
  locked: boolean;
};

export type PhysicsSceneApi = {
  setGravityEnabled: (enabled: boolean) => void;
  setJointTarget: (name: string, angleDeg: number) => void;
  resetPose: () => void;
  triggerStepCycle: () => void;
  setView: (view: PresetViewName) => void;
  toggleOrthoPersp: () => void;
  dispose: () => void;
};
