import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { createPhysicsScene } from "./createPhysicsScene";
import type { JointControlState, PhysicsSceneApi, SelectionInfo } from "./types";

export function usePhysicsScene(hostRef: RefObject<HTMLDivElement | null>) {
  const apiRef = useRef<PhysicsSceneApi | null>(null);
  const onSelectionRef = useRef<(selection: SelectionInfo | null) => void>(() => {});
  const onJointRef = useRef<(state: JointControlState | null) => void>(() => {});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [joint, setJoint] = useState<JointControlState | null>(null);

  onSelectionRef.current = setSelection;
  onJointRef.current = setJoint;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let api: PhysicsSceneApi | null = null;

    createPhysicsScene(host, {
      onSelectionChange: (next) => onSelectionRef.current(next),
      onJointChange: (next) => onJointRef.current(next),
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

  return {
    ready,
    error,
    selection,
    joint,
    setGravityEnabled,
    setJointTarget,
  };
}
