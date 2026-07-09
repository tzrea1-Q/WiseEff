import { CircleX } from "lucide-react";
import { useEffect, useState } from "react";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import type { PowerManagementParameterTemplate, PowerManagementProject, PowerManagementRisk } from "../powerManagementConfig";
import { ParameterDefinitionForm } from "./ParameterDefinitionForm";

const NAME_RE = /^[a-z][a-z0-9_]*$/;

export interface CreateParameterDraft {
  name: string;
  module: string;
  unit: string;
  risk: PowerManagementRisk;
  description: string;
  explanation: string;
  configFormat: string;
  range: string;
  recommendedValue: string;
  valueKind: PowerManagementParameterTemplate["valueKind"];
}

function buildDraftParameter(
  projects: readonly PowerManagementProject[],
  moduleNodes: readonly FlatModuleNode[],
  existingParameters: readonly PowerManagementParameterTemplate[]
): PowerManagementParameterTemplate {
  const defaultModule =
    moduleNodes[0]?.name ?? [...new Set(existingParameters.map((parameter) => parameter.module))].sort()[0] ?? "";
  const values = projects.reduce<PowerManagementParameterTemplate["values"]>((acc, project) => {
    acc[project.id] = { currentValue: "", recommendedValue: "", updatedAt: "" };
    return acc;
  }, {} as PowerManagementParameterTemplate["values"]);

  return {
    id: "create-parameter-draft",
    name: "",
    module: defaultModule,
    unit: "",
    risk: "Medium",
    description: "",
    explanation: "",
    configFormat: "",
    range: "",
    valueKind: "scalar",
    values
  };
}

function getCreateValidationErrors(
  draft: PowerManagementParameterTemplate,
  existingParameters: readonly PowerManagementParameterTemplate[]
) {
  const name = draft.name.trim();
  const nameError = !name
    ? "参数名不能为空"
    : !NAME_RE.test(name)
      ? "只允许小写字母、数字、下划线，且首字符为字母"
      : existingParameters.some((parameter) => parameter.name === name)
        ? "已存在同名参数"
        : null;
  const moduleError = !draft.module.trim() ? "模块不能为空" : null;

  return { nameError, moduleError, canSubmit: !nameError && !moduleError };
}

export function CreateParameterDialog({
  open,
  projects,
  moduleNodes,
  existingParameters,
  onConfirm,
  onCancel
}: {
  open: boolean;
  projects: readonly PowerManagementProject[];
  moduleNodes: readonly FlatModuleNode[];
  existingParameters: readonly PowerManagementParameterTemplate[];
  onConfirm: (draft: CreateParameterDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<PowerManagementParameterTemplate>(() =>
    buildDraftParameter(projects, moduleNodes, existingParameters)
  );

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, open]);

  useEffect(() => {
    if (open) {
      setDraft(buildDraftParameter(projects, moduleNodes, existingParameters));
    }
  }, [open, projects, moduleNodes, existingParameters]);

  if (!open) {
    return null;
  }

  const firstProjectId = projects[0]?.id;
  const recommendedValue = firstProjectId ? draft.values[firstProjectId]?.recommendedValue ?? "" : "";
  const { canSubmit } = getCreateValidationErrors(draft, existingParameters);

  const handleMetadataChange = (patch: Partial<Omit<PowerManagementParameterTemplate, "id" | "values">>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const handleRecommendedValueChange = (value: string) => {
    setDraft((current) => ({
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
      name: draft.name.trim(),
      module: draft.module.trim(),
      unit: draft.unit,
      risk: draft.risk,
      description: draft.description,
      explanation: draft.explanation,
      configFormat: draft.configFormat,
      range: draft.range,
      recommendedValue,
      valueKind: draft.valueKind
    });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="新增参数">
      <div className="submission-dialog param-admin-editor-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">共享参数定义</span>
            <h2 id="create-parameter-title">新增参数</h2>
            <p>填写名称、模块、风险、推荐值与描述信息，创建后对所有项目生效。</p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onCancel} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-editor-dialog-body">
          <ParameterDefinitionForm
            allParameters={existingParameters}
            moduleNodes={moduleNodes}
            parameter={draft}
            projects={projects}
            onMetadataChange={handleMetadataChange}
            onRecommendedValueChange={handleRecommendedValueChange}
          />
        </div>

        <div className="dialog-actions">
          <button className="button subtle" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="button primary" type="button" disabled={!canSubmit} onClick={handleSubmit}>
            创建参数
          </button>
        </div>
      </div>
    </div>
  );
}
