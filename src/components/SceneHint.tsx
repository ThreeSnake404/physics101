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
        <span>
          Views: Front (Pad 1), Top (Pad 7), Right (Pad 3), Ortho/Persp (Pad 5).
        </span>
      ) : (
        <span>Loading physics…</span>
      )}
    </div>
  );
}
