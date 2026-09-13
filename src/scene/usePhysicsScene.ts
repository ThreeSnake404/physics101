import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { createPhysicsScene } from "./createPhysicsScene";
import type {
  BalanceState,
  JointControlState,
  PhysicsSceneApi,
  PresetViewName,
  SelectionInfo,
  ViewState,
} from "./types";

export function usePhysicsScene(hostRef: RefObject<HTMLDivElement | null>) {
  const apiRef = useRef<PhysicsSceneApi | null>(null);
  const onSelectionRef = useRef<(selection: SelectionInfo | null) => void>(() => {});
  const onJointRef = useRef<(state: JointControlState | null) => void>(() => {});
  const onViewStateRef = useRef<(state: ViewState) => void>(() => {});
  const onBalanceRef = useRef<(state: BalanceState) => void>(() => {});

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [joint, setJoint] = useState<JointControlState | null>(null);
  const [viewState, setViewState] = useState<ViewState>({
    isOrtho: false,
    activeView: "front",
  });
  const [balanceState, setBalanceState] = useState<BalanceState>({
    active: false,
    pitchDeg: 0,
    pitchRateDeg: 0,
    isPitchingForward: false,
    adjustmentMagnitude: 0,
    chassisGrounded: false,
    status: "idle",
    steppingPhase: "idle",
    stepCount: 0,
  });

  onSelectionRef.current = setSelection;
  onJointRef.current = setJoint;
  onViewStateRef.current = setViewState;
  onBalanceRef.current = setBalanceState;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let api: PhysicsSceneApi | null = null;

    createPhysicsScene(host, {
      onSelectionChange: (next) => onSelectionRef.current(next),
      onJointChange: (next) => onJointRef.current(next),
      onViewStateChange: (next) => onViewStateRef.current(next),
      onBalanceChange: (next) => onBalanceRef.current(next),
    })
      .then((created) => {
        if (cancelled) {
          created.dispose();
          return;
        }
        api = created;
        apiRef.current = created;
        setReady(true);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Failed to start the scene");
      });

    return () => {
      cancelled = true;
      api?.dispose();
      apiRef.current = null;
    };
  }, [hostRef]);

  const setGravityEnabled = useCallback((enabled: boolean) => {
    apiRef.current?.setGravityEnabled(enabled);
  }, []);

  const setJointTarget = useCallback((name: string, angleDeg: number) => {
    apiRef.current?.setJointTarget(name, angleDeg);
  }, []);

  const resetPose = useCallback(() => {
    apiRef.current?.resetPose();
  }, []);

  const triggerStepCycle = useCallback(() => {
    apiRef.current?.triggerStepCycle();
  }, []);

  const setView = useCallback((view: PresetViewName) => {
    apiRef.current?.setView(view);
  }, []);

  const toggleOrthoPersp = useCallback(() => {
    apiRef.current?.toggleOrthoPersp();
  }, []);

  return {
    ready,
    error,
    selection,
    joint,
    viewState,
    balanceState,
    resetPose,
    triggerStepCycle,
    setGravityEnabled,
    setJointTarget,
    setView,
    toggleOrthoPersp,
  };
}
