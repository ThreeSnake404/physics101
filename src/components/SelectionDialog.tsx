import type { SelectionInfo } from "../scene/types";

type SelectionDialogProps = {
  selection: SelectionInfo | null;
};

function formatAxis(value: number) {
  return value.toFixed(3);
}

export function SelectionDialog({ selection }: SelectionDialogProps) {
  return (
    <aside className={`selection-dock${selection ? " is-open" : ""}`} aria-live="polite">
      {selection ? (
        <section className="selection-dialog" aria-label="Selected object">
          <p className="selection-kicker">Selected</p>
          <h2 className="selection-name">{selection.name}</h2>
          <dl className="selection-axes">
            <div className="selection-axis selection-axis-x">
              <dt>X</dt>
              <dd>{formatAxis(selection.x)}</dd>
            </div>
            <div className="selection-axis selection-axis-y">
              <dt>Y</dt>
              <dd>{formatAxis(selection.y)}</dd>
            </div>
            <div className="selection-axis selection-axis-z">
              <dt>Z</dt>
              <dd>{formatAxis(selection.z)}</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </aside>
  );
}
