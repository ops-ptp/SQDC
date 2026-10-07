import { Button } from './ui';

/** Pinned bar shown while an admin rearranges KPIs. */
export default function ArrangeBar({
  hint,
  dirty,
  saving,
  error,
  onCancel,
  onSave,
}: {
  hint: string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="arrange-bar" role="region" aria-label="Arrange KPIs">
      <div className="arrange-bar-text">
        <b>Arrange KPIs</b>
        <span>{hint}</span>
        {error && <span className="arrange-bar-error">{error}</span>}
      </div>
      <div className="arrange-bar-actions">
        <Button onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button themeColor="primary" onClick={onSave} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save order'}
        </Button>
      </div>
    </div>
  );
}
