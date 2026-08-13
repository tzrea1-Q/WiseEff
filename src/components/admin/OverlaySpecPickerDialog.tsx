import { ChevronLeft, CircleX, Plus } from "lucide-react";
import { useState } from "react";

import { ModalDialog } from "@/components/common/ModalDialog";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import {
  ParameterSpecLibrary,
  type ParameterSpecLibraryRow
} from "@/components/parameter-topology/ParameterSpecLibrary";
import {
  OverlaySpecCreateDialog,
  type OverlaySpecCreateResult
} from "@/components/admin/OverlaySpecCreateDialog";

export type OverlaySpecPickerConfirm =
  | { kind: "link"; parameterSpecId: string; propertyKey: string; driverModule?: string | null }
  | ({ kind: "create" } & OverlaySpecCreateResult);

export type OverlaySpecPickerDialogProps = {
  specs: readonly ParameterSpecLibraryRow[];
  loading?: boolean;
  busy?: boolean;
  excludedSpecIds?: ReadonlySet<string>;
  onBack: () => void;
  onConfirm: (result: OverlaySpecPickerConfirm) => void;
};

/**
 * L2 definition picker for overlay authoring — embeds the definition-library
 * table (search + column filters). Escape / 返回 only closes this layer.
 */
export function OverlaySpecPickerDialog({
  specs,
  loading = false,
  busy = false,
  excludedSpecIds,
  onBack,
  onConfirm
}: OverlaySpecPickerDialogProps) {
  const [selectedSpecId, setSelectedSpecId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const availableSpecs = excludedSpecIds
    ? specs.filter((spec) => !excludedSpecIds.has(spec.id))
    : specs;

  const selected = availableSpecs.find((spec) => spec.id === selectedSpecId) ?? null;
  const canConfirm = !busy && selected != null;

  return (
    <>
      <ModalDialog
        open
        onDismiss={busy ? undefined : onBack}
        className="submission-dialog param-admin-module-edit-dialog overlay-spec-picker-dialog"
        backdropClassName="param-admin-modal-backdrop organization-driver-schema-stack-backdrop"
      >
        {({ titleId }) => (
          <>
          <div className="submission-dialog-head param-admin-editor-dialog-head">
            <div className="param-admin-editor-dialog-head-text overlay-spec-picker-dialog__head">
              <button
                type="button"
                className="button ghost overlay-spec-picker-dialog__back"
                disabled={busy}
                onClick={onBack}
              >
                <ChevronLeft size={16} aria-hidden="true" />
                {PARAMETER_ADMIN_UI.organizationDriverSchemaPickerBack}
              </button>
              <span className="eyebrow">{PARAMETER_ADMIN_UI.organizationDriverSchemaPickerTitle}</span>
              <h2 id={titleId}>{PARAMETER_ADMIN_UI.organizationDriverSchemaPickerTitle}</h2>
              <p>{PARAMETER_ADMIN_UI.organizationDriverSchemaPickerBlurb}</p>
            </div>
            <button
              type="button"
              className="audit-dialog-close-icon"
              onClick={onBack}
              aria-label="关闭"
              disabled={busy}
            >
              <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>

          <div className="param-admin-module-edit-body overlay-spec-picker-dialog__body">
            <div className="overlay-spec-picker-dialog__toolbar">
              <button
                type="button"
                className="button subtle"
                disabled={busy || loading}
                onClick={() => setCreateOpen(true)}
              >
                <Plus size={14} aria-hidden="true" />
                {PARAMETER_ADMIN_UI.organizationDriverSchemaCreateNew}
              </button>
            </div>
            <ParameterSpecLibrary
              embedded
              specs={availableSpecs}
              selectedSpecId={selectedSpecId}
              loading={loading}
              onSelectSpec={setSelectedSpecId}
            />
          </div>

          <div className="dialog-actions">
            <button className="button subtle" type="button" onClick={onBack} disabled={busy}>
              取消
            </button>
            <button
              className="button primary"
              type="button"
              disabled={!canConfirm}
              onClick={() => {
                if (!selected) return;
                onConfirm({
                  kind: "link",
                  parameterSpecId: selected.id,
                  propertyKey: selected.propertyKey,
                  driverModule: selected.driverModule
                });
              }}
            >
              {PARAMETER_ADMIN_UI.organizationDriverSchemaPickerConfirm}
            </button>
          </div>
          </>
        )}
      </ModalDialog>

      {createOpen ? (
        <OverlaySpecCreateDialog
          busy={busy}
          onCancel={() => setCreateOpen(false)}
          onConfirm={(result) => {
            setCreateOpen(false);
            onConfirm({ kind: "create", ...result });
          }}
        />
      ) : null}
    </>
  );
}
