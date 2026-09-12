export type PresetViewName = "front" | "top" | "right";

export type ViewState = {
  isOrtho: boolean;
  activeView: PresetViewName | null;
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
  setView: (view: PresetViewName) => void;
  toggleOrthoPersp: () => void;
  dispose: () => void;
};
