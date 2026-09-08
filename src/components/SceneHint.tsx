type SceneHintProps = {
  ready: boolean;
  error: string | null;
};

export function SceneHint({ ready, error }: SceneHintProps) {
  return (
    <div className="scene-hint">
      <strong>Rapier + two-legs</strong>
      {error ? (
        <span>{error}</span>
      ) : ready ? (
        <span>Front view: +Z toward the screen. Click a part to inspect it.</span>
      ) : (
        <span>Loading physics…</span>
      )}
    </div>
  );
}
