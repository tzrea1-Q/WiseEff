import { CircleX, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import type {
  CreateOrganizationDriverSchemaInput,
  OrganizationDriverSchemaValueShapeKind
} from "@/application/ports/ParameterModuleRegistryRepository";

export type LinkedOverlaySpec =
  | {
      kind: "link";
      parameterSpecId: string;
      propertyKey: string;
      driverModule?: string | null;
    }
  | {
      kind: "create";
      propertyKey: string;
      valueShape: { kind: OrganizationDriverSchemaValueShapeKind };
      units?: string;
      documentation?: string;
    };

export type OrganizationDriverSchemaDialogProps = {
  compatible: string;
  linkedSpecs: readonly LinkedOverlaySpec[];
  busy?: boolean;
  /** True while a nested picker/create dialog owns focus. */
  suspended?: boolean;
  onCancel: () => void;
  onAddProperty: () => void;
  onRemoveProperty: (index: number) => void;
  onSubmit: (input: CreateOrganizationDriverSchemaInput) => void | Promise<void>;
};

function linkedLabel(item: LinkedOverlaySpec): string {
  if (item.kind === "link") {
    const module = item.driverModule?.trim();
    return module ? `${item.propertyKey} · ${module}` : item.propertyKey;
  }
  return item.propertyKey;
}

export function OrganizationDriverSchemaDialog({
  compatible,
  linkedSpecs,
  busy = false,
  suspended = false,
  onCancel,
  onAddProperty,
  onRemoveProperty,
  onSubmit
}: OrganizationDriverSchemaDialogProps) {
  const displayNameId = useId();
  const notesId = useId();
  const compatibleId = useId();
  const [displayName, setDisplayName] = useState(compatible);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    setDisplayName(compatible);
    setNotes("");
  }, [compatible]);

  useEffect(() => {
    if (suspended) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, suspended]);

  const canSubmit = useMemo(() => {
    if (busy || displayName.trim().length === 0) return false;
    return linkedSpecs.length > 0;
  }, [busy, displayName, linkedSpecs.length]);

  return (
    <div
      className={`modal-backdrop param-admin-module-edit-backdrop${suspended ? " is-suspended" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-hidden={suspended || undefined}
      aria-label={PARAMETER_ADMIN_UI.organizationDriverSchemaDialogTitle}
    >
      <div
        className={`submission-dialog param-admin-module-edit-dialog organization-driver-schema-dialog${
          suspended ? " is-suspended" : ""
        }`}
      >
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">{PARAMETER_ADMIN_UI.organizationDriverSchemaDialogTitle}</span>
            <h2>{PARAMETER_ADMIN_UI.organizationDriverSchemaDialogTitle}</h2>
            <p>
              为本 compatible 声明解析属性：从定义库选用或新建参数定义，保存后立即激活并刷新解析覆盖。
            </p>
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

        <div className="param-admin-module-edit-body">
          <div className="organization-driver-schema-dialog__field">
            <label htmlFor={compatibleId}>compatible</label>
            <input id={compatibleId} value={compatible} readOnly disabled />
          </div>

          <div className="organization-driver-schema-dialog__field">
            <label htmlFor={displayNameId}>{PARAMETER_ADMIN_UI.organizationDriverSchemaDisplayName}</label>
            <input
              id={displayNameId}
              value={displayName}
              disabled={busy}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>

          <div className="organization-driver-schema-dialog__field">
            <label htmlFor={notesId}>{PARAMETER_ADMIN_UI.organizationDriverSchemaNotes}</label>
            <textarea
              id={notesId}
              value={notes}
              disabled={busy}
              rows={2}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <section
            className="module-edit-compatible-rules"
            aria-label={PARAMETER_ADMIN_UI.organizationDriverSchemaProperties}
          >
            <div className="module-edit-compatible-rules__head">
              <h3>{PARAMETER_ADMIN_UI.organizationDriverSchemaProperties}</h3>
            </div>

            {linkedSpecs.length === 0 ? (
              <p className="muted organization-driver-schema-dialog__empty">
                {PARAMETER_ADMIN_UI.organizationDriverSchemaEmptyLinks}
              </p>
            ) : (
              <ul className="organization-driver-schema-dialog__link-list">
                {linkedSpecs.map((item, index) => (
                  <li key={`${item.kind}-${item.propertyKey}-${index}`}>
                    <div className="organization-driver-schema-dialog__link-row">
                      <div className="organization-driver-schema-dialog__link-text">
                        <strong>{linkedLabel(item)}</strong>
                        {item.kind === "create" ? (
                          <span className="organization-driver-schema-dialog__link-badge">
                            {PARAMETER_ADMIN_UI.organizationDriverSchemaPendingCreate}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="button ghost"
                        disabled={busy}
                        aria-label={`${PARAMETER_ADMIN_UI.organizationDriverSchemaRemoveLink} ${item.propertyKey}`}
                        onClick={() => onRemoveProperty(index)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        {PARAMETER_ADMIN_UI.organizationDriverSchemaRemoveLink}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              className="button subtle organization-driver-schema-dialog__add"
              disabled={busy}
              onClick={onAddProperty}
            >
              <Plus size={14} aria-hidden="true" />
              {PARAMETER_ADMIN_UI.organizationDriverSchemaAddProperty}
            </button>
          </section>
        </div>

        <div className="dialog-actions">
          <button className="button subtle" type="button" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            className="button primary"
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              if (!canSubmit) return;
              const payload: CreateOrganizationDriverSchemaInput = {
                compatible,
                displayName: displayName.trim(),
                notes: notes.trim() || undefined,
                properties: linkedSpecs.map((item) => {
                  if (item.kind === "link") {
                    return { parameterSpecId: item.parameterSpecId };
                  }
                  return {
                    propertyKey: item.propertyKey,
                    valueShape: item.valueShape,
                    ...(item.units ? { units: item.units } : {}),
                    ...(item.documentation ? { documentation: item.documentation } : {})
                  };
                })
              };
              void onSubmit(payload);
            }}
          >
            {PARAMETER_ADMIN_UI.organizationDriverSchemaSaveActivate}
          </button>
        </div>
      </div>
    </div>
  );
}
