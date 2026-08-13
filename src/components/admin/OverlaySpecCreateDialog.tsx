import { CircleX } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { ModalDialog } from "@/components/common/ModalDialog";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import type { OrganizationDriverSchemaValueShapeKind } from "@/application/ports/ParameterModuleRegistryRepository";

const VALUE_SHAPE_OPTIONS: Array<{ value: OrganizationDriverSchemaValueShapeKind; label: string }> = [
  { value: "u32-array", label: "u32-array" },
  { value: "string-list", label: "string-list" },
  { value: "bool", label: "bool" },
  { value: "mixed", label: "mixed" },
  { value: "unknown", label: "unknown" }
];

export type OverlaySpecCreateResult = {
  propertyKey: string;
  valueShape: { kind: OrganizationDriverSchemaValueShapeKind };
  units?: string;
  documentation?: string;
};

export type OverlaySpecCreateDialogProps = {
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (result: OverlaySpecCreateResult) => void;
};

/**
 * L3 create form for overlay authoring — writes into the definition library
 * when the parent schema is saved (no blank create API on ParameterSpec yet).
 */
export function OverlaySpecCreateDialog({
  busy = false,
  onCancel,
  onConfirm
}: OverlaySpecCreateDialogProps) {
  const propertyKeyId = useId();
  const valueShapeId = useId();
  const unitsId = useId();
  const documentationId = useId();
  const [propertyKey, setPropertyKey] = useState("");
  const [valueShapeKind, setValueShapeKind] =
    useState<OrganizationDriverSchemaValueShapeKind>("unknown");
  const [units, setUnits] = useState("");
  const [documentation, setDocumentation] = useState("");

  const canConfirm = useMemo(
    () => !busy && propertyKey.trim().length > 0,
    [busy, propertyKey]
  );

  return (
    <ModalDialog
      open
      onDismiss={busy ? undefined : onCancel}
      className="submission-dialog param-admin-module-edit-dialog organization-driver-schema-create-dialog"
      backdropClassName="param-admin-modal-backdrop organization-driver-schema-stack-backdrop organization-driver-schema-create-backdrop"
    >
      {({ titleId }) => (
        <>
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">{PARAMETER_ADMIN_UI.organizationDriverSchemaCreateTitle}</span>
            <h2 id={titleId}>{PARAMETER_ADMIN_UI.organizationDriverSchemaCreateTitle}</h2>
            <p>填写属性键与值类型。确认后带回叠加层；激活 schema 时写入参数定义库。</p>
          </div>
          <button
            type="button"
            className="audit-dialog-close-icon"
            onClick={onCancel}
            aria-label="关闭"
            disabled={busy}
          >
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-module-edit-body">
          <div className="organization-driver-schema-dialog__field">
            <label htmlFor={propertyKeyId}>{PARAMETER_ADMIN_UI.organizationDriverSchemaPropertyKey}</label>
            <input
              id={propertyKeyId}
              value={propertyKey}
              disabled={busy}
              placeholder="例如 enable-gpios"
              autoFocus
              onChange={(event) => setPropertyKey(event.target.value)}
            />
          </div>
          <div className="organization-driver-schema-dialog__field">
            <label htmlFor={valueShapeId}>{PARAMETER_ADMIN_UI.organizationDriverSchemaValueShape}</label>
            <select
              id={valueShapeId}
              value={valueShapeKind}
              disabled={busy}
              onChange={(event) =>
                setValueShapeKind(event.target.value as OrganizationDriverSchemaValueShapeKind)
              }
            >
              {VALUE_SHAPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="organization-driver-schema-dialog__field">
            <label htmlFor={unitsId}>{PARAMETER_ADMIN_UI.organizationDriverSchemaUnits}</label>
            <input
              id={unitsId}
              value={units}
              disabled={busy}
              onChange={(event) => setUnits(event.target.value)}
            />
          </div>
          <div className="organization-driver-schema-dialog__field">
            <label htmlFor={documentationId}>
              {PARAMETER_ADMIN_UI.organizationDriverSchemaDocumentation}
            </label>
            <input
              id={documentationId}
              value={documentation}
              disabled={busy}
              onChange={(event) => setDocumentation(event.target.value)}
            />
          </div>
        </div>

        <div className="dialog-actions">
          <button className="button subtle" type="button" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            className="button primary"
            type="button"
            disabled={!canConfirm}
            onClick={() => {
              if (!canConfirm) return;
              onConfirm({
                propertyKey: propertyKey.trim(),
                valueShape: { kind: valueShapeKind },
                ...(units.trim() ? { units: units.trim() } : {}),
                ...(documentation.trim() ? { documentation: documentation.trim() } : {})
              });
            }}
          >
            {PARAMETER_ADMIN_UI.organizationDriverSchemaCreateConfirm}
          </button>
        </div>
        </>
      )}
    </ModalDialog>
  );
}
