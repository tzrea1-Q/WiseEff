import { CircleX } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import type { CreateParameterSpecInput } from "@/application/ports/ParameterTopologyRepository";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";

export type SpecCreateSubjectOption = {
  attributionSubjectId: string;
  label: string;
  kind: "driver-group" | "node-type";
  compatibleHint?: string | null;
};

export type SpecCreateDialogProps = {
  subjects: SpecCreateSubjectOption[];
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (input: CreateParameterSpecInput & { coverageCompatible?: string }) => void;
};

export function subjectsFromModules(modules: ParameterModule[]): SpecCreateSubjectOption[] {
  return modules
    .filter(
      (module) =>
        (module.kind === "driver-group" || module.kind === "node-type") &&
        Boolean(module.attributionSubjectId),
    )
    .map((module) => ({
      attributionSubjectId: module.attributionSubjectId!,
      label: `${module.name} (${module.kind === "driver-group" ? "驱动登记" : "节点类型"})`,
      kind: module.kind as "driver-group" | "node-type",
      compatibleHint: module.sourceKey?.startsWith("compatible:")
        ? module.sourceKey.slice("compatible:".length)
        : null,
    }));
}

/**
 * Mature ParameterSpec create entry: must pick AttributionSubject before save.
 */
export function SpecCreateDialog({
  subjects,
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: SpecCreateDialogProps) {
  const subjectId = useId();
  const propertyKeyId = useId();
  const documentationId = useId();
  const compatibleId = useId();
  const [attributionSubjectId, setAttributionSubjectId] = useState(subjects[0]?.attributionSubjectId ?? "");
  const [propertyKey, setPropertyKey] = useState("");
  const [documentation, setDocumentation] = useState("");
  const [coverageCompatible, setCoverageCompatible] = useState(
    subjects[0]?.compatibleHint ?? "",
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onCancel]);

  const selected = useMemo(
    () => subjects.find((subject) => subject.attributionSubjectId === attributionSubjectId) ?? null,
    [attributionSubjectId, subjects],
  );

  const canConfirm =
    !busy &&
    attributionSubjectId.trim().length > 0 &&
    propertyKey.trim().length > 0 &&
    documentation.trim().length > 0;

  return (
    <div
      className="modal-backdrop param-admin-module-edit-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="新建参数定义"
    >
      <div className="submission-dialog param-admin-module-edit-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">参数定义库</span>
            <h2>新建参数定义</h2>
            <p>先选择归属主体，再填写属性键与文档。保存为草稿；激活前需显式挂上解析覆盖。</p>
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
            <label htmlFor={subjectId}>归属主体</label>
            <select
              id={subjectId}
              value={attributionSubjectId}
              disabled={busy || subjects.length === 0}
              onChange={(event) => {
                const next = event.target.value;
                setAttributionSubjectId(next);
                const hit = subjects.find((subject) => subject.attributionSubjectId === next);
                if (hit?.compatibleHint) setCoverageCompatible(hit.compatibleHint);
              }}
            >
              {subjects.length === 0 ? (
                <option value="">暂无可用驱动登记 / 节点类型</option>
              ) : (
                subjects.map((subject) => (
                  <option key={subject.attributionSubjectId} value={subject.attributionSubjectId}>
                    {subject.label}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="organization-driver-schema-dialog__field">
            <label htmlFor={propertyKeyId}>属性键</label>
            <input
              id={propertyKeyId}
              value={propertyKey}
              disabled={busy}
              placeholder="例如 gpio_int"
              autoFocus
              onChange={(event) => setPropertyKey(event.target.value)}
            />
          </div>
          <div className="organization-driver-schema-dialog__field">
            <label htmlFor={documentationId}>文档说明</label>
            <textarea
              id={documentationId}
              value={documentation}
              disabled={busy}
              rows={4}
              placeholder="说明该参数的语义与约束"
              onChange={(event) => setDocumentation(event.target.value)}
            />
          </div>
          {selected?.kind === "driver-group" ? (
            <div className="organization-driver-schema-dialog__field">
              <label htmlFor={compatibleId}>激活时挂接的 compatible（可选）</label>
              <input
                id={compatibleId}
                value={coverageCompatible}
                disabled={busy}
                placeholder="例如 vendor,sc8562"
                onChange={(event) => setCoverageCompatible(event.target.value)}
              />
            </div>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="submission-dialog-actions">
          <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!canConfirm}
            onClick={() =>
              onConfirm({
                attributionSubjectId,
                propertyKey: propertyKey.trim(),
                documentation: documentation.trim(),
                reason: "library create",
                valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 },
                constraints: { cells: 1 },
                coverageCompatible: coverageCompatible.trim() || undefined,
              })
            }
          >
            {busy ? "保存中…" : "保存草稿"}
          </button>
        </div>
      </div>
    </div>
  );
}
