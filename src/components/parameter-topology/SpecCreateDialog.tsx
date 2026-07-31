import { CircleX } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import type { CreateParameterSpecInput } from "@/application/ports/ParameterTopologyRepository";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import {
  MODULE_KIND_LABEL,
  toAttributionFlatNodes,
} from "@/components/parameter-topology/moduleAttributionTreeUtils";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";

export type SpecCreateSubjectOption = {
  moduleId: string;
  attributionSubjectId: string;
  label: string;
  kind: "driver-group" | "node-type";
  compatibleHint?: string | null;
};

export type SpecCreateDialogProps = {
  /** Full module registry used to render the attribution subject tree. */
  modules: ParameterModule[];
  /** True while the parent is still loading module options. */
  subjectsLoading?: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (input: CreateParameterSpecInput & { coverageCompatible?: string }) => void;
};

type ValueShapeKind =
  | "unknown"
  | "bool"
  | "empty"
  | "string"
  | "string-list"
  | "cells"
  | "phandle-list"
  | "u32-array"
  | "bytes"
  | "mixed";

const VALUE_SHAPE_OPTIONS: Array<{ value: ValueShapeKind; label: string }> = [
  { value: "unknown", label: "unknown（草稿可后补）" },
  { value: "bool", label: "bool" },
  { value: "empty", label: "empty" },
  { value: "string", label: "string" },
  { value: "string-list", label: "string-list" },
  { value: "cells", label: "cells" },
  { value: "phandle-list", label: "phandle-list" },
  { value: "u32-array", label: "u32-array" },
  { value: "bytes", label: "bytes" },
  { value: "mixed", label: "mixed" },
];

function needsCellFields(kind: ValueShapeKind): boolean {
  return kind === "cells" || kind === "phandle-list" || kind === "u32-array";
}

function buildValueShape(
  kind: ValueShapeKind,
  bits: number,
  groups: number,
  cellsPerGroup: number,
  bytesLength: number,
): Record<string, unknown> {
  if (needsCellFields(kind)) {
    return {
      kind,
      bits: kind === "u32-array" ? 32 : bits,
      groups,
      cellsPerGroup,
    };
  }
  if (kind === "bytes") {
    return { kind, length: bytesLength };
  }
  return { kind };
}

function defaultConstraintsForShape(shape: Record<string, unknown>): Record<string, unknown> {
  const kind = String(shape.kind ?? "");
  if (kind === "cells" || kind === "u32-array" || kind === "phandle-list") {
    const cells =
      typeof shape.cellsPerGroup === "number" && Number.isInteger(shape.cellsPerGroup)
        ? shape.cellsPerGroup
        : typeof shape.cells === "number" && Number.isInteger(shape.cells)
          ? shape.cells
          : null;
    return cells == null ? {} : { cells };
  }
  if (kind === "bytes" && typeof shape.length === "number" && Number.isFinite(shape.length)) {
    return { minLength: shape.length, maxLength: shape.length };
  }
  return {};
}

function parseOptionalJson(raw: string, label: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false, error: `${label} 不是合法 JSON。` };
  }
}

export function subjectsFromModules(modules: ParameterModule[]): SpecCreateSubjectOption[] {
  return modules
    .filter(
      (module) =>
        (module.kind === "driver-group" || module.kind === "node-type") &&
        Boolean(module.attributionSubjectId),
    )
    .map((module) => ({
      moduleId: module.id,
      attributionSubjectId: module.attributionSubjectId!,
      label: `${module.name} (${module.kind === "driver-group" ? "驱动登记" : "节点类型"})`,
      kind: module.kind as "driver-group" | "node-type",
      compatibleHint: module.sourceKey?.startsWith("compatible:")
        ? module.sourceKey.slice("compatible:".length)
        : null,
    }));
}

/** Keep selectable subjects plus their ancestors so ModuleTreeSelect stays connected. */
export function subjectPickerFlatNodes(modules: readonly ParameterModule[]): FlatModuleNode[] {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const keep = new Set<string>();
  for (const module of modules) {
    if (
      (module.kind !== "driver-group" && module.kind !== "node-type") ||
      !module.attributionSubjectId
    ) {
      continue;
    }
    let current: ParameterModule | undefined = module;
    const guard = new Set<string>();
    while (current && !guard.has(current.id)) {
      guard.add(current.id);
      keep.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return toAttributionFlatNodes(
    modules
      .filter((module) => keep.has(module.id))
      .map((module) =>
        module.kind === "driver-group" || module.kind === "node-type"
          ? {
              ...module,
              name: `${module.name}（${MODULE_KIND_LABEL[module.kind]}）`,
            }
          : module,
      ),
  );
}

/**
 * Mature ParameterSpec create entry: must pick AttributionSubject before save.
 * Fields mirror CreateParameterSpecInput / createParameterSpecBodySchema.
 */
export function SpecCreateDialog({
  modules,
  subjectsLoading = false,
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: SpecCreateDialogProps) {
  const subjectFieldId = useId();
  const propertyKeyId = useId();
  const displayNameId = useId();
  const descriptionId = useId();
  const documentationId = useId();
  const valueShapeId = useId();
  const bitsId = useId();
  const groupsId = useId();
  const cellsPerGroupId = useId();
  const bytesLengthId = useId();
  const constraintsId = useId();
  const unitsId = useId();
  const exampleValueId = useId();
  const reasonId = useId();
  const overridePlatformId = useId();
  const compatibleId = useId();

  const subjects = useMemo(() => subjectsFromModules(modules), [modules]);
  const treeNodes = useMemo(() => subjectPickerFlatNodes(modules), [modules]);
  const selectableIds = useMemo(
    () => new Set(subjects.map((subject) => subject.moduleId)),
    [subjects],
  );

  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [propertyKey, setPropertyKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [documentation, setDocumentation] = useState("");
  const [valueShapeKind, setValueShapeKind] = useState<ValueShapeKind>("unknown");
  const [bits, setBits] = useState(32);
  const [groups, setGroups] = useState(1);
  const [cellsPerGroup, setCellsPerGroup] = useState(1);
  const [bytesLength, setBytesLength] = useState(1);
  const [constraintsText, setConstraintsText] = useState("");
  const [units, setUnits] = useState("");
  const [exampleValueText, setExampleValueText] = useState("");
  const [reason, setReason] = useState("library create");
  const [overridePlatform, setOverridePlatform] = useState(false);
  const [coverageCompatible, setCoverageCompatible] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedModuleId && subjects[0]) {
      setSelectedModuleId(subjects[0].moduleId);
      if (subjects[0].compatibleHint) {
        setCoverageCompatible(subjects[0].compatibleHint);
      }
    }
  }, [selectedModuleId, subjects]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!busy) onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [busy, onCancel]);

  const selected = useMemo(
    () => subjects.find((subject) => subject.moduleId === selectedModuleId) ?? null,
    [selectedModuleId, subjects],
  );
  const attributionSubjectId = selected?.attributionSubjectId ?? "";

  const canConfirm =
    !busy &&
    !subjectsLoading &&
    attributionSubjectId.trim().length > 0 &&
    propertyKey.trim().length > 0 &&
    reason.trim().length > 0;

  const handleConfirm = () => {
    if (!canConfirm) return;
    setLocalError(null);

    const valueShape = buildValueShape(valueShapeKind, bits, groups, cellsPerGroup, bytesLength);
    const constraintsParsed = parseOptionalJson(constraintsText, "约束 constraints");
    if (!constraintsParsed.ok) {
      setLocalError(constraintsParsed.error);
      return;
    }
    const exampleParsed = parseOptionalJson(exampleValueText, "示例值");
    if (!exampleParsed.ok) {
      setLocalError(exampleParsed.error);
      return;
    }

    const constraints =
      constraintsParsed.value === undefined
        ? defaultConstraintsForShape(valueShape)
        : (constraintsParsed.value as Record<string, unknown>);

    if (
      constraintsParsed.value !== undefined &&
      (typeof constraintsParsed.value !== "object" ||
        constraintsParsed.value === null ||
        Array.isArray(constraintsParsed.value))
    ) {
      setLocalError("约束 constraints 必须是 JSON 对象。");
      return;
    }

    onConfirm({
      attributionSubjectId,
      propertyKey: propertyKey.trim(),
      reason: reason.trim(),
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      documentation: documentation.trim(),
      valueShape,
      constraints,
      ...(units.trim() ? { units: units.trim() } : { units: null }),
      ...(exampleParsed.value !== undefined ? { exampleValue: exampleParsed.value } : {}),
      ...(overridePlatform ? { overridePlatform: true } : {}),
      coverageCompatible: coverageCompatible.trim() || undefined,
    });
  };

  const displayError = localError ?? error;

  return (
    <div
      className="modal-backdrop param-admin-module-edit-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="新建参数定义"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="submission-dialog param-admin-module-edit-dialog spec-create-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">参数定义库</span>
            <h2>新建参数定义</h2>
            <p>
              先选择归属主体，再填写可写入创建契约的字段。保存为草稿；激活前需显式挂上解析覆盖。
            </p>
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
          <div className="organization-driver-schema-dialog__field spec-create-dialog__subject-field">
            <span className="organization-driver-schema-dialog__field-label" id={subjectFieldId}>
              归属主体
            </span>
            {subjectsLoading ? (
              <p className="muted small">正在加载归属主体…</p>
            ) : treeNodes.length === 0 ? (
              <p className="muted small">暂无可用驱动登记 / 节点类型</p>
            ) : (
              <ModuleTreeSelect
                mode="single"
                label="归属主体"
                labelledBy={subjectFieldId}
                nodes={treeNodes}
                value={selectedModuleId}
                selectableIds={selectableIds}
                placeholder="请选择驱动登记或节点类型"
                disabled={busy}
                onChange={(next) => {
                  const moduleId = typeof next === "string" ? next : "";
                  setSelectedModuleId(moduleId);
                  const hit = subjects.find((subject) => subject.moduleId === moduleId);
                  if (hit?.compatibleHint) {
                    setCoverageCompatible(hit.compatibleHint);
                  } else if (hit?.kind !== "driver-group") {
                    setCoverageCompatible("");
                  }
                }}
              />
            )}
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
            <label htmlFor={displayNameId}>展示名</label>
            <input
              id={displayNameId}
              value={displayName}
              disabled={busy}
              placeholder="可选；默认可用属性键"
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>

          <div className="organization-driver-schema-dialog__field">
            <label htmlFor={descriptionId}>简短描述</label>
            <input
              id={descriptionId}
              value={description}
              disabled={busy}
              placeholder="可选"
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="organization-driver-schema-dialog__field">
            <label htmlFor={documentationId}>文档说明</label>
            <textarea
              id={documentationId}
              value={documentation}
              disabled={busy}
              rows={3}
              placeholder="说明该参数的语义与约束"
              onChange={(event) => setDocumentation(event.target.value)}
            />
          </div>

          <div className="organization-driver-schema-dialog__field">
            <label htmlFor={valueShapeId}>值形状 valueShape</label>
            <select
              id={valueShapeId}
              value={valueShapeKind}
              disabled={busy}
              onChange={(event) => setValueShapeKind(event.target.value as ValueShapeKind)}
            >
              {VALUE_SHAPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {needsCellFields(valueShapeKind) ? (
            <>
              <div className="organization-driver-schema-dialog__field">
                <label htmlFor={bitsId}>bits</label>
                <input
                  id={bitsId}
                  type="number"
                  min={8}
                  step={8}
                  value={bits}
                  disabled={busy || valueShapeKind === "u32-array"}
                  onChange={(event) => setBits(Number(event.target.value) || 32)}
                />
              </div>
              <div className="organization-driver-schema-dialog__field">
                <label htmlFor={groupsId}>groups</label>
                <input
                  id={groupsId}
                  type="number"
                  min={1}
                  value={groups}
                  disabled={busy}
                  onChange={(event) => setGroups(Math.max(1, Number(event.target.value) || 1))}
                />
              </div>
              <div className="organization-driver-schema-dialog__field">
                <label htmlFor={cellsPerGroupId}>cellsPerGroup</label>
                <input
                  id={cellsPerGroupId}
                  type="number"
                  min={1}
                  value={cellsPerGroup}
                  disabled={busy}
                  onChange={(event) =>
                    setCellsPerGroup(Math.max(1, Number(event.target.value) || 1))
                  }
                />
              </div>
            </>
          ) : null}

          {valueShapeKind === "bytes" ? (
            <div className="organization-driver-schema-dialog__field">
              <label htmlFor={bytesLengthId}>bytes.length</label>
              <input
                id={bytesLengthId}
                type="number"
                min={0}
                value={bytesLength}
                disabled={busy}
                onChange={(event) => setBytesLength(Math.max(0, Number(event.target.value) || 0))}
              />
            </div>
          ) : null}

          <div className="organization-driver-schema-dialog__field">
            <label htmlFor={constraintsId}>约束 constraints（JSON，可空）</label>
            <textarea
              id={constraintsId}
              value={constraintsText}
              disabled={busy}
              rows={3}
              placeholder='留空则按 valueShape 推导；例如 {"cells":1}'
              className="parameter-admin-code-editor"
              onChange={(event) => setConstraintsText(event.target.value)}
            />
          </div>

          <div className="organization-driver-schema-dialog__field">
            <label htmlFor={unitsId}>单位</label>
            <input
              id={unitsId}
              value={units}
              disabled={busy}
              placeholder="例如 uV、mA"
              onChange={(event) => setUnits(event.target.value)}
            />
          </div>

          <div className="organization-driver-schema-dialog__field">
            <label htmlFor={exampleValueId}>示例值（JSON，可空）</label>
            <textarea
              id={exampleValueId}
              value={exampleValueText}
              disabled={busy}
              rows={2}
              placeholder='仅作示例，不参与校验；例如 "<&gpio13 29 0>" 或 [1,2]'
              className="parameter-admin-code-editor"
              onChange={(event) => setExampleValueText(event.target.value)}
            />
          </div>

          <div className="organization-driver-schema-dialog__field">
            <label htmlFor={reasonId}>变更原因</label>
            <input
              id={reasonId}
              value={reason}
              disabled={busy}
              placeholder="写入审计"
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          {selected?.kind === "driver-group" ? (
            <div className="organization-driver-schema-dialog__field">
              <label htmlFor={compatibleId}>激活时挂接的 compatible（可选）</label>
              <input
                id={compatibleId}
                value={coverageCompatible}
                disabled={busy}
                placeholder="例如 vendor,sc8562；填写后保存并尝试激活"
                onChange={(event) => setCoverageCompatible(event.target.value)}
              />
            </div>
          ) : null}

          <div className="organization-driver-schema-dialog__field spec-create-dialog__check-field">
            <label htmlFor={overridePlatformId} className="spec-create-dialog__check-label">
              <input
                id={overridePlatformId}
                type="checkbox"
                checked={overridePlatform}
                disabled={busy}
                onChange={(event) => setOverridePlatform(event.target.checked)}
              />
              <span>确认覆盖平台级定义（overridePlatform）</span>
            </label>
            <p className="muted small">
              仅当同主体 + 属性键已存在平台定义时需要勾选，否则创建会返回冲突。
            </p>
          </div>

          {displayError ? (
            <p className="form-error" role="alert">
              {displayError}
            </p>
          ) : null}
        </div>

        <div className="dialog-actions">
          <button type="button" className="button subtle" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="button" className="button primary" disabled={!canConfirm} onClick={handleConfirm}>
            {busy ? "保存中…" : "保存草稿"}
          </button>
        </div>
      </div>
    </div>
  );
}
