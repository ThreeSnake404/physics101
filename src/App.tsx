import { useCallback, useRef, useState } from "react";

import { BalanceHud } from "./components/BalanceHud";
import { GravityToggle } from "./components/GravityToggle";
import { RotatePartDialog } from "./components/RotatePartDialog";
import { SceneHint } from "./components/SceneHint";
import { SelectionDialog } from "./components/SelectionDialog";
import { ViewControls } from "./components/ViewControls";
import { usePhysicsScene } from "./scene/usePhysicsScene";

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [gravityOn, setGravityOn] = useState(false);
  const {
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
  } = usePhysicsScene(hostRef);

  const toggleGravity = useCallback(() => {
    setGravityOn((current) => {
      const next = !current;
      setGravityEnabled(next);
      return next;
    });
  }, [setGravityEnabled]);

  const handleResetPose = useCallback(() => {
    resetPose();
  }, [resetPose]);

  const handleStepCycle = useCallback(() => {
    triggerStepCycle();
  }, [triggerStepCycle]);

  const handleTargetChange = useCallback(
    (next: number) => {
      if (!selection) return;
      setJointTarget(selection.name, next);
    },
    [selection, setJointTarget],
  );

  return (
    <div className="app">
      <div ref={hostRef} className="viewport" />
      <div className="hud-left">
        <SceneHint ready={ready} error={error} />
        <div className="hud-row">
          <GravityToggle enabled={gravityOn} disabled={!ready} onToggle={toggleGravity} />
        </div>
        <ViewControls
          disabled={!ready}
          isOrtho={viewState.isOrtho}
          activeView={viewState.activeView}
          onFront={() => setView("front")}
          onTop={() => setView("top")}
          onRight={() => setView("right")}
          onToggleOrtho={toggleOrthoPersp}
        />
        <BalanceHud
          state={balanceState}
          gravityEnabled={gravityOn}
          disabled={!ready}
          onReset={handleResetPose}
          onStep={handleStepCycle}
        />
      </div>
      <aside className="hud-right">
        <SelectionDialog selection={selection} />
        <RotatePartDialog
          partName={selection?.name ?? null}
          joint={joint}
          disabled={!ready}
          onTargetChange={handleTargetChange}
        />
      </aside>
    </div>
  );
}
