import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModalDialog } from "./ModalDialog";
import "./import-dialog.css";

export function ImportDialog({ open, scope, title, description, closeDisabled, onClose, utilities, actions, children }: {
  open: boolean;
  scope: string;
  title: string;
  description: string;
  closeDisabled: boolean;
  onClose: () => void;
  utilities?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return <ModalDialog open={open} onDismiss={closeDisabled ? undefined : onClose}
    className="import-dialog" backdropClassName="param-admin-modal-backdrop" describedBy>
    {({ titleId, descriptionId }) => <>
      <header className="import-dialog__header">
        <div>
          <span className="eyebrow">{scope}</span>
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId} className="import-dialog__secondary">{description}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="关闭" disabled={closeDisabled} onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </header>
      <div className="import-dialog__body">{children}</div>
      <footer className="import-dialog__footer">
        {utilities ? <div className="import-dialog__utilities">{utilities}</div> : null}
        <div className="dialog-actions">
          <Button type="button" variant="outline" disabled={closeDisabled} onClick={onClose}>关闭</Button>
          {actions}
        </div>
      </footer>
    </>}
  </ModalDialog>;
}
