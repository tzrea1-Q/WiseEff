import { CircleX } from "lucide-react";
import { useEffect, useState } from "react";
import { ParameterDefinitionForm } from "@/components/ParameterDefinitionForm";
import { RiskPicker } from "@/components/RiskPicker";
import type { ParsedImportRow, ReviewedImportRow } from "@/application/parameters/import/types";
import type { Project } from "@/mockData";
import type { PowerManagementParameterTemplate } from "@/powerManagementConfig";

export type ImportReviewCardProps = {
  row: ReviewedImportRow;
  projects: Project[];
  moduleNames: string[];
  libraryParameters: PowerManagementParameterTemplate[];
  onApprove: (rowId: string) => void;
  onSkip: (rowId: string, reason: string) => void;
  onUpdate: (rowId: string, patch: Partial<ParsedImportRow>) => void;
  onConfirmNew: (rowId: string, patch: Partial<ParsedImportRow>) => void;
};

type EditableFields = Pick<
  ParsedImportRow,
  | "name"
  | "module"
  | "currentValue"
  | "recommendedValue"
  | "range"
  | "unit"
  | "risk"
  | "description"
  | "explanation"
  | "configFormat"
>;

type DiffField = {
  key: "currentValue" | "recommendedValue" | "range" | "unit" | "risk";
  label: string;
};

const DIFF_FIELDS: DiffField[] = [
  { key: "currentValue", label: "当前值" },
  { key: "recommendedValue", label: "推荐值" },
  { key: "range", label: "范围" },
  { key: "unit", label: "单位" },
  { key: "risk", label: "风险" }
];

const STATUS_LABEL: Record<ReviewedImportRow["status"], string> = {
  pending: "待核对",
  approved: "已通过",
  skipped: "已跳过",
  "needs-module": "待补全模块",
  conflict: "冲突",
  "new-confirmed": "已创建"
};

function buildModuleOptions(modules: readonly string[], currentModule: string) {
  const moduleSet = new Set(modules.map((moduleName) => moduleName.trim()).filter(Boolean));
  if (currentModule.trim()) {
    moduleSet.add(currentModule.trim());
  }
  return Array.from(moduleSet).sort((left, right) => left.localeCompare(right));
}

function ImportModuleSelect({
  value,
  onChange,
  moduleNames,
  ariaLabel
}: {
  value: string;
  onChange: (value: string) => void;
  moduleNames: string[];
  ariaLabel: string;
}) {
  const options = buildModuleOptions(moduleNames, value);

  return (
    <label className="import-review-module-select">
      <span>模块</span>
      <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="" disabled>
          请选择模块
        </option>
        {options.map((moduleName) => (
          <option key={moduleName} value={moduleName}>
            {moduleName}
          </option>
        ))}
      </select>
    </label>
  );
}

function toEditableFields(row: ReviewedImportRow): EditableFields {
  return {
    name: row.name,
    module: row.module,
    currentValue: row.currentValue ?? "",
    recommendedValue: row.recommendedValue ?? "",
    range: row.range ?? "",
    unit: row.unit ?? "",
    risk: row.risk ?? "Medium",
    description: row.description ?? "",
    explanation: row.explanation ?? "",
    configFormat: row.configFormat ?? ""
  };
}

function buildTemplateFromRow(row: ReviewedImportRow, projects: Project[]): PowerManagementParameterTemplate {
  const values = projects.reduce<PowerManagementParameterTemplate["values"]>((acc, project) => {
    acc[project.id] = {
      currentValue: row.currentValue ?? "",
      recommendedValue: row.recommendedValue ?? "",
      updatedAt: ""
    };
    return acc;
  }, {} as PowerManagementParameterTemplate["values"]);

  return {
    id: `import-row-draft-${row.rowId}`,
    name: row.name,
    module: row.module,
    unit: row.unit ?? "",
    risk: row.risk ?? "Medium",
    description: row.description ?? "",
    explanation: row.explanation ?? "",
    configFormat: row.configFormat ?? "",
    range: row.range ?? "",
    valueKind: row.valueKind ?? "scalar",
    values
  };
}

export function ImportReviewCard({
  row,
  projects,
  moduleNames,
  libraryParameters,
  onApprove,
  onSkip,
  onUpdate,
  onConfirmNew
}: ImportReviewCardProps) {
  const [mode, setMode] = useState<"view" | "editing" | "skipping">("view");
  const [draft, setDraft] = useState<EditableFields>(() => toEditableFields(row));
  const [skipReason, setSkipReason] = useState(row.skipReason ?? "");
  const [moduleInput, setModuleInput] = useState(row.module);
  const [prefillOpen, setPrefillOpen] = useState(false);

  const isNewCandidate = row.status === "pending" && !row.existingParameter;

  const startEdit = () => {
    setDraft(toEditableFields(row));
    setMode("editing");
  };

  const cancelEdit = () => setMode("view");

  const saveEdit = () => {
    onUpdate(row.rowId, { ...draft, name: draft.name.trim(), module: draft.module.trim() });
    setMode("view");
  };

  const startSkip = () => {
    setSkipReason(row.skipReason ?? "");
    setMode("skipping");
  };

  const cancelSkip = () => setMode("view");

  const confirmSkip = () => {
    onSkip(row.rowId, skipReason.trim());
    setMode("view");
  };

  const confirmModule = () => {
    if (!moduleInput.trim()) {
      return;
    }
    onUpdate(row.rowId, { module: moduleInput.trim() });
  };

  const renderActions = () => {
    if (mode === "editing") {
      return (
        <div className="import-review-edit-form">
          <div className="parameter-import-wizard-grid">
            <label>
              <span>参数名</span>
              <input aria-label="编辑参数名" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <ImportModuleSelect
              ariaLabel="编辑模块"
              value={draft.module}
              moduleNames={moduleNames}
              onChange={(module) => setDraft({ ...draft, module })}
            />
            <label>
              <span>当前值</span>
              <input aria-label="编辑当前值" value={draft.currentValue ?? ""} onChange={(event) => setDraft({ ...draft, currentValue: event.target.value })} />
            </label>
            <label>
              <span>推荐值</span>
              <input
                aria-label="编辑推荐值"
                value={draft.recommendedValue ?? ""}
                onChange={(event) => setDraft({ ...draft, recommendedValue: event.target.value })}
              />
            </label>
            <label>
              <span>范围</span>
              <input aria-label="编辑范围" value={draft.range ?? ""} onChange={(event) => setDraft({ ...draft, range: event.target.value })} />
            </label>
            <label>
              <span>单位</span>
              <input aria-label="编辑单位" value={draft.unit ?? ""} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} />
            </label>
            <label>
              <span>风险</span>
              <RiskPicker value={draft.risk ?? "Medium"} onChange={(risk) => setDraft({ ...draft, risk })} />
            </label>
          </div>
          <div className="dialog-actions">
            <button type="button" className="button subtle" onClick={cancelEdit}>
              取消
            </button>
            <button type="button" className="button primary" onClick={saveEdit}>
              保存
            </button>
          </div>
        </div>
      );
    }

    if (mode === "skipping") {
      return (
        <div className="import-review-skip-form">
          <label>
            <span>跳过原因</span>
            <textarea aria-label="跳过原因" rows={2} value={skipReason} onChange={(event) => setSkipReason(event.target.value)} />
          </label>
          <div className="dialog-actions">
            <button type="button" className="button subtle" onClick={cancelSkip}>
              取消
            </button>
            <button type="button" className="button primary" onClick={confirmSkip}>
              确认跳过
            </button>
          </div>
        </div>
      );
    }

    switch (row.status) {
      case "needs-module":
        return (
          <div className="import-review-module-form">
            <p className="import-review-message" role="alert">
              该行缺少模块信息，请填写模块后再通过。
            </p>
            <ImportModuleSelect
              ariaLabel="补全模块"
              value={moduleInput}
              moduleNames={moduleNames}
              onChange={setModuleInput}
            />
            <div className="dialog-actions">
              <button type="button" className="button subtle" onClick={startSkip}>
                跳过
              </button>
              <button type="button" className="button primary" disabled={!moduleInput.trim()} onClick={confirmModule}>
                确认模块
              </button>
            </div>
          </div>
        );
      case "conflict":
        return (
          <div className="import-review-conflict">
            <p className="import-review-message" role="alert">
              该行的参数名 + 模块组合与本批次其他行重复，请编辑修改后再通过，或选择跳过。
            </p>
            <div className="dialog-actions">
              <button type="button" className="button subtle" onClick={startSkip}>
                跳过
              </button>
              <button type="button" className="button primary" onClick={startEdit}>
                编辑
              </button>
            </div>
          </div>
        );
      case "approved":
        return <p className="import-review-status-summary">已通过，将在应用阶段更新到参数库。</p>;
      case "skipped":
        return <p className="import-review-status-summary">跳过原因：{row.skipReason || "（未填写原因）"}</p>;
      case "new-confirmed":
        return <p className="import-review-status-summary">已确认新增，将在应用阶段创建到参数库。</p>;
      case "pending":
      default:
        if (isNewCandidate) {
          return (
            <div className="import-review-new-candidate">
              <div className="dialog-actions">
                <button type="button" className="button subtle" onClick={startSkip}>
                  跳过
                </button>
                <button type="button" className="button primary" onClick={() => setPrefillOpen(true)}>
                  预填并创建
                </button>
              </div>
            </div>
          );
        }
        return (
          <div className="dialog-actions">
            <button type="button" className="button subtle" onClick={startSkip}>
              跳过
            </button>
            <button type="button" className="button subtle" onClick={startEdit}>
              编辑
            </button>
            <button type="button" className="button primary" onClick={() => onApprove(row.rowId)}>
              通过
            </button>
          </div>
        );
    }
  };

  return (
    <section className="import-review-card" aria-label={`导入行 ${row.name || "未命名参数"}`}>
      <header className="import-review-card-header">
        <div className="import-review-card-heading">
          <strong>{row.name || "（未命名）"}</strong>
          <span className="import-review-card-module">{row.module || "（未填写模块）"}</span>
        </div>
        <div className="import-review-card-badges">
          <span className="import-review-status-badge">{STATUS_LABEL[row.status]}</span>
          {isNewCandidate ? <span className="import-review-badge-new">库中不存在</span> : null}
        </div>
      </header>

      {row.existingParameter ? (
        <table className="import-review-diff-table" aria-label="字段差异">
          <thead>
            <tr>
              <th>字段</th>
              <th>库中值</th>
              <th>导入值</th>
            </tr>
          </thead>
          <tbody>
            {DIFF_FIELDS.map(({ key, label }) => {
              const existingValue = String(row.existingParameter?.[key] ?? "");
              const importedValue = String(row[key] ?? "");
              const changed = existingValue !== importedValue;
              return (
                <tr key={key} className={changed ? "import-review-diff-row import-review-diff-row--changed" : "import-review-diff-row"}>
                  <td>{label}</td>
                  <td>{existingValue || "—"}</td>
                  <td>{importedValue || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {renderActions()}

      {prefillOpen ? (
        <NewParameterPrefillDialog
          row={row}
          projects={projects}
          moduleNames={moduleNames}
          libraryParameters={libraryParameters}
          onCancel={() => setPrefillOpen(false)}
          onConfirm={(patch) => {
            onConfirmNew(row.rowId, patch);
            setPrefillOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

function NewParameterPrefillDialog({
  row,
  projects,
  moduleNames,
  libraryParameters,
  onCancel,
  onConfirm
}: {
  row: ReviewedImportRow;
  projects: Project[];
  moduleNames: string[];
  libraryParameters: PowerManagementParameterTemplate[];
  onCancel: () => void;
  onConfirm: (patch: Partial<ParsedImportRow>) => void;
}) {
  const [draftParameter, setDraftParameter] = useState<PowerManagementParameterTemplate>(() => buildTemplateFromRow(row, projects));

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const firstProjectId = projects[0]?.id;
  const recommendedValue = firstProjectId ? draftParameter.values[firstProjectId]?.recommendedValue ?? "" : "";
  const canSubmit = Boolean(draftParameter.name.trim()) && Boolean(draftParameter.module.trim());

  const handleMetadataChange = (patch: Partial<Omit<PowerManagementParameterTemplate, "id" | "values">>) => {
    setDraftParameter((current) => ({ ...current, ...patch }));
  };

  const handleRecommendedValueChange = (value: string) => {
    setDraftParameter((current) => ({
      ...current,
      values: projects.reduce<PowerManagementParameterTemplate["values"]>((acc, project) => {
        const existing = current.values[project.id] ?? { currentValue: "", recommendedValue: "", updatedAt: "" };
        acc[project.id] = { ...existing, recommendedValue: value };
        return acc;
      }, {} as PowerManagementParameterTemplate["values"])
    }));
  };

  const handleSubmit = () => {
    if (!canSubmit) {
      return;
    }
    onConfirm({
      name: draftParameter.name.trim(),
      module: draftParameter.module.trim(),
      unit: draftParameter.unit,
      risk: draftParameter.risk,
      description: draftParameter.description,
      explanation: draftParameter.explanation,
      configFormat: draftParameter.configFormat,
      range: draftParameter.range,
      recommendedValue,
      valueKind: draftParameter.valueKind
    });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`预填并创建参数 ${row.name}`}>
      <div className="submission-dialog param-admin-editor-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">批量导入 · 新增参数</span>
            <h2>预填并创建</h2>
            <p>基于导入行内容预填参数定义，确认后标记为已创建，将在应用阶段写入参数库。</p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onCancel} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-editor-dialog-body">
          <ParameterDefinitionForm
            parameter={draftParameter}
            projects={projects}
            modules={moduleNames}
            allParameters={libraryParameters}
            onMetadataChange={handleMetadataChange}
            onRecommendedValueChange={handleRecommendedValueChange}
          />
        </div>

        <div className="dialog-actions">
          <button type="button" className="button subtle" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="button primary" disabled={!canSubmit} onClick={handleSubmit}>
            确认创建
          </button>
        </div>
      </div>
    </div>
  );
}
