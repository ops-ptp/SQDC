import { useState, type DragEvent } from 'react';

export type PivotZone = 'filters' | 'rows' | 'columns';

export interface PivotField {
  key: string;
  label: string;
}

interface Props {
  fields: PivotField[];
  assignment: Partial<Record<PivotZone, string>>;
  onAssignmentChange: (next: Partial<Record<PivotZone, string>>) => void;
}

const ZONE_LABEL: Record<PivotZone, string> = {
  filters: 'Filters',
  rows: 'Rows',
  columns: 'Columns',
};

/** Excel PivotTable field-list panel: drag a field chip from "Available
 * fields" into Filters/Rows/Columns (or drag one zone's chip into another
 * to move it, or back onto Available fields to clear it). Each zone holds
 * at most one field — dropping a second one replaces whatever was there.
 * "Σ Values" is shown but not interactive: the only thing this page can
 * aggregate is a count of entries, so there's nothing meaningful to drag
 * there — it's included purely so the panel still reads as a familiar
 * pivot-table field list rather than missing a zone. */
export default function PivotFieldPanel({ fields, assignment, onAssignmentChange }: Props) {
  const assignedKeys = new Set(Object.values(assignment).filter((v): v is string => Boolean(v)));
  const availableFields = fields.filter((f) => !assignedKeys.has(f.key));

  function moveField(fieldKey: string, toZone: PivotZone | 'available') {
    const next = { ...assignment };
    for (const z of Object.keys(next) as PivotZone[]) {
      if (next[z] === fieldKey) delete next[z];
    }
    if (toZone !== 'available') next[toZone] = fieldKey;
    onAssignmentChange(next);
  }

  function handleChipDragStart(e: DragEvent, fieldKey: string) {
    e.dataTransfer.setData('text/plain', fieldKey);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleZoneDrop(e: DragEvent, zone: PivotZone | 'available') {
    e.preventDefault();
    const fieldKey = e.dataTransfer.getData('text/plain');
    if (fieldKey) moveField(fieldKey, zone);
  }

  return (
    <div className="pivot-field-panel">
      <div className="pivot-field-panel-title">Pivot fields</div>

      <div
        className="pivot-available-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => handleZoneDrop(e, 'available')}
      >
        <div className="pivot-zone-label">Available fields</div>
        <div className="pivot-field-chip-list">
          {availableFields.length === 0 && <span className="pivot-empty-hint">All fields assigned</span>}
          {availableFields.map((f) => (
            <div key={f.key} className="pivot-field-chip" draggable onDragStart={(e) => handleChipDragStart(e, f.key)}>
              {f.label}
            </div>
          ))}
        </div>
      </div>

      {(['filters', 'rows', 'columns'] as PivotZone[]).map((zone) => (
        <PivotDropZone
          key={zone}
          label={ZONE_LABEL[zone]}
          field={assignment[zone] ? fields.find((f) => f.key === assignment[zone]) : undefined}
          onDrop={(e) => handleZoneDrop(e, zone)}
          onChipDragStart={handleChipDragStart}
          onRemove={() => {
            const next = { ...assignment };
            delete next[zone];
            onAssignmentChange(next);
          }}
        />
      ))}

      <div className="pivot-drop-zone pivot-values-zone">
        <div className="pivot-zone-label">Σ Values</div>
        <div className="pivot-field-chip pivot-field-chip-locked">Count of entries</div>
      </div>
    </div>
  );
}

function PivotDropZone({
  label,
  field,
  onDrop,
  onChipDragStart,
  onRemove,
}: {
  label: string;
  field?: PivotField;
  onDrop: (e: DragEvent) => void;
  onChipDragStart: (e: DragEvent, fieldKey: string) => void;
  onRemove: () => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`pivot-drop-zone ${over ? 'pivot-drop-zone-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        onDrop(e);
      }}
    >
      <div className="pivot-zone-label">{label}</div>
      {field ? (
        <div className="pivot-field-chip" draggable onDragStart={(e) => onChipDragStart(e, field.key)}>
          {field.label}
          <button type="button" className="pivot-field-chip-remove" onClick={onRemove} aria-label={`Remove ${field.label}`}>
            ×
          </button>
        </div>
      ) : (
        <div className="pivot-drop-zone-placeholder">Drag a field here</div>
      )}
    </div>
  );
}
