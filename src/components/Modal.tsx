import { Dialog } from '@progress/kendo-react-dialogs';

interface Props {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}

/** App modal, built on KendoReact's (free) Dialog — it handles the overlay,
 * Escape-to-close, focus trapping and the portal to <body>, so it sits above
 * the board grid wherever it's opened from. Bodies still render their own
 * `.modal-actions` row, so call sites didn't change. */
export default function Modal({ title, onClose, children, maxWidth = 480 }: Props) {
  return (
    <Dialog title={title} onClose={onClose} width={`min(${maxWidth}px, calc(100vw - 32px))`} className="app-dialog">
      <div className="modal-body">{children}</div>
    </Dialog>
  );
}
