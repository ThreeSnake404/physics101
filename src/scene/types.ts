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
  dispose: () => void;
};
