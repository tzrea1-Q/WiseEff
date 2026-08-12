import { CircleX } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import type { RegisterOrClaimDriverInput } from "@/application/ports/ParameterModuleRegistryRepository";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import { toBusinessFlatNodes } from "./moduleAttributionTreeUtils";

export type RegisterDriverDialogProps = {
  modules: readonly ParameterModule[];
  busy?: boolean;
  initialDisplayName?: string;
  initialCompatibles?: readonly string[];
  onCancel: () => void;
  onConfirm: (input: RegisterOrClaimDriverInput) => void;
};

export function RegisterDriverDialog({
  modules,
  busy = false,
  initialDisplayName = "",
  initialCompatibles = [],
  onCancel,
  onConfirm
}: RegisterDriverDialogProps) {
  const displayNameId = useId();
  const businessCategoryLabelId = useId();
  const compatiblesId = useId();
  const notesId = useId();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [businessCategoryIdValue, setBusinessCategoryIdValue] = useState("");
  const [compatiblesText, setCompatiblesText] = useState(initialCompatibles.join("\n"));
  const [notes, setNotes] = useState("");

  const businessNodes = useMemo(() => toBusinessFlatNodes(modules), [modules]);

  useEffect(() => {
    setBusinessCategoryIdValue(businessNodes[0]?.id ?? "");
  }, [businessNodes]);

  useEffect(() => {
    setDisplayName(initialDisplayName);
    setCompatiblesText(initialCompatibles.join("\n"));
  }, [initialCompatibles, initialDisplayName]);

  const compatibles = compatiblesText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const canConfirm =
    displayName.trim().length > 0 &&
    businessCategoryIdValue.length > 0 &&
    compatibles.length > 0 &&
    !busy;

  return (
    <ModalDialog
      open
      onDismiss={onCancel}
      className="submission-dialog param-admin-module-edit-dialog register-driver-dialog"
      backdropClassName="param-admin-modal-backdrop"
    >
      {({ titleId }) => (
        <>
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">{PARAMETER_ADMIN_UI.driverRegistryRegisterDialogTitle}</span>
            <h2 id={titleId}>{PARAMETER_ADMIN_UI.driverRegistryRegisterDialogTitle}</h2>
          </div>
          <button
            type="button"
            className="audit-dialog-close-icon"
            onClick={onCancel}
            aria-label="关闭"
          >
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <form
          className="param-admin-module-edit-body register-driver-dialog__body"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canConfirm) return;
            onConfirm({
              displayName: displayName.trim(),
              businessCategoryId: businessCategoryIdValue,
              compatibles,
              notes: notes.trim() || undefined
            });
          }}
        >
          <div className="register-driver-dialog__field">
            <label className="register-driver-dialog__label" htmlFor={displayNameId}>
              {PARAMETER_ADMIN_UI.driverRegistryDisplayName}
            </label>
            <input
              id={displayNameId}
              className="register-driver-dialog__input"
              type="text"
              value={displayName}
              maxLength={200}
              disabled={busy}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>

          <div className="register-driver-dialog__field">
            <span className="register-driver-dialog__label" id={businessCategoryLabelId}>
              {PARAMETER_ADMIN_UI.driverRegistryBusinessCategory}
            </span>
            <ModuleTreeSelect
              mode="single"
              label={PARAMETER_ADMIN_UI.driverRegistryBusinessCategory}
              labelledBy={businessCategoryLabelId}
              nodes={businessNodes}
              value={businessCategoryIdValue}
              disabled={busy || businessNodes.length === 0}
              placeholder="选择业务分类"
              onChange={(next) => setBusinessCategoryIdValue(typeof next === "string" ? next : "")}
            />
          </div>

          <div className="register-driver-dialog__field">
            <label className="register-driver-dialog__label" htmlFor={compatiblesId}>
              {PARAMETER_ADMIN_UI.driverRegistryCompatibles}
            </label>
            <textarea
              id={compatiblesId}
              className="register-driver-dialog__input"
              rows={4}
              value={compatiblesText}
              disabled={busy}
              placeholder="vendor,sc8562"
              onChange={(event) => setCompatiblesText(event.target.value)}
            />
          </div>

          <div className="register-driver-dialog__field">
            <label className="register-driver-dialog__label" htmlFor={notesId}>
              {PARAMETER_ADMIN_UI.driverRegistryNotes}
            </label>
            <textarea
              id={notesId}
              className="register-driver-dialog__input"
              rows={2}
              maxLength={500}
              value={notes}
              disabled={busy}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <div className="param-admin-module-edit-actions">
            <button type="button" className="button subtle" disabled={busy} onClick={onCancel}>
              取消
            </button>
            <button type="submit" className="button" disabled={!canConfirm}>
              {PARAMETER_ADMIN_UI.driverRegistryRegister}
            </button>
          </div>
        </form>
        </>
      )}
    </ModalDialog>
  );
}
