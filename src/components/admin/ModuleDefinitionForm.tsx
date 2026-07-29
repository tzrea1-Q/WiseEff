import { useState, type ReactNode } from "react";
import type { ModuleImportance, ModuleKind } from "@/domain/parameter-topology/moduleRegistry";
import type { ParameterModuleDraft } from "@/powerManagementConfig";
import { shouldShowFieldError } from "@/components/common/fieldValidation";

const IMPORTANCE_OPTIONS: Array<{ value: ModuleImportance; label: string }> = [
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" }
];

const RECLASSIFY_KIND_OPTIONS: Array<{ value: "business" | "instance" | "logical"; label: string }> = [
  { value: "business", label: "业务分类" },
  { value: "instance", label: "器件实例" },
  { value: "logical", label: "逻辑节点" }
];

export function ModuleDefinitionForm({
  module,
  existingNames,
  currentName,
  onChange,
  showErrors = false,
  showImportance = false,
  importance = "medium",
  onImportanceChange,
  showKind = false,
  kind = "business",
  onKindChange,
  leading = null,
  trailing = null
}: {
  module: ParameterModuleDraft;
  existingNames: readonly string[];
  currentName?: string;
  onChange: (patch: Partial<ParameterModuleDraft>) => void;
  showErrors?: boolean;
  /** When true, show business-module importance (parameter attribution only). */
  showImportance?: boolean;
  importance?: ModuleImportance;
  onImportanceChange?: (value: ModuleImportance) => void;
  /** When true, show controlled kind reclassify (business / instance / logical). */
  showKind?: boolean;
  kind?: ModuleKind;
  onKindChange?: (value: "business" | "instance" | "logical") => void;
  /** Extra fields rendered inside the same styled form (e.g. create kind / parent). */
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const [nameTouched, setNameTouched] = useState(false);
  const nameError = getModuleNameError(module.name, existingNames, currentName);
  const visibleNameError = shouldShowFieldError(nameError, { touched: nameTouched, submitted: showErrors });
  const importanceVisible = showImportance && (!showKind || kind === "business");

  return (
    <form className="param-module-def-form" onSubmit={(event) => event.preventDefault()}>
      {leading}
      <label>
        模块名称
        <input
          aria-invalid={visibleNameError ? "true" : "false"}
          aria-label="模块名称"
          value={module.name}
          onBlur={() => setNameTouched(true)}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        {visibleNameError ? <span className="field-error">{nameError}</span> : null}
      </label>
      {showKind ? (
        <label>
          模块类型
          <select
            aria-label="模块类型"
            value={kind === "driver-group" || kind === "unclassified" ? "business" : kind}
            onChange={(event) =>
              onKindChange?.(event.target.value as "business" | "instance" | "logical")
            }
          >
            {RECLASSIFY_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {importanceVisible ? (
        <label>
          重要性
          <select
            aria-label="模块重要性"
            value={importance}
            onChange={(event) => onImportanceChange?.(event.target.value as ModuleImportance)}
          >
            {IMPORTANCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        展示描述
        <textarea
          aria-label="模块展示描述"
          rows={2}
          value={module.description}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </label>
      <label>
        适用范围
        <textarea
          aria-label="适用范围"
          rows={2}
          placeholder="说明该模块覆盖的业务范围与治理边界"
          value={module.scope}
          onChange={(event) => onChange({ scope: event.target.value })}
        />
      </label>
      {trailing}
    </form>
  );
}

export function getModuleNameError(name: string, existingNames: readonly string[], currentName?: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    return "模块名称不能为空";
  }
  if (trimmed !== currentName && existingNames.includes(trimmed)) {
    return "已存在同名模块";
  }
  return null;
}

export function canSubmitModuleDraft(module: ParameterModuleDraft, existingNames: readonly string[], currentName?: string) {
  return !getModuleNameError(module.name, existingNames, currentName);
}
