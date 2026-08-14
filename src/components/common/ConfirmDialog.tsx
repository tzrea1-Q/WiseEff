import { useEffect, useState, type ReactNode } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** State the blast radius here, not just the action name. */
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  pending?: boolean;
  pendingLabel?: string;
  /**
   * An extra risk the user must tick before confirming, used when a validation gate
   * reports `requiresConfirmation`. Confirming stays disabled until it is acknowledged.
   */
  acknowledgement?: ReactNode;
  /** Additional fields the confirmation collects, such as an audit reason. */
  extra?: ReactNode;
  error?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The house confirmation step for irreversible governance operations, following the
 * DeleteProjectDialog pattern on top of the shared modal contract.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "取消",
  tone = "primary",
  pending = false,
  pendingLabel,
  acknowledgement,
  extra,
  error = "",
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (open) {
      setAcknowledged(false);
    }
  }, [open, title]);

  const blocked = Boolean(acknowledgement) && !acknowledged;

  return (
    <ModalDialog
      open={open}
      onDismiss={pending ? undefined : onCancel}
      className="confirm-dialog governance-confirm-dialog"
      backdropClassName="param-admin-modal-backdrop"
      describedBy
    >
      {({ titleId, descriptionId }) => (
        <>
          <h2 id={titleId}>{title}</h2>
          <div className="confirm-dialog__scroll">
            <div id={descriptionId} className="governance-confirm-dialog__body">
              {description}
            </div>
            {extra}
            {acknowledgement ? (
              <label className="governance-confirm-dialog__acknowledge">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={pending}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>{acknowledgement}</span>
              </label>
            ) : null}
            {error ? (
              <p className="governance-confirm-dialog__error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <div className="dialog-actions">
            <button className="button subtle" type="button" disabled={pending} onClick={onCancel}>
              {cancelLabel}
            </button>
            <button
              className={`button ${tone}`}
              type="button"
              disabled={pending || blocked}
              onClick={onConfirm}
            >
              {pending ? (pendingLabel ?? "处理中…") : confirmLabel}
            </button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
