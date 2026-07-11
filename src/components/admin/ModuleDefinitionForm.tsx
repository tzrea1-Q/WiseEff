import { useState } from "react";
import type { ParameterModuleDraft } from "@/powerManagementConfig";
import { shouldShowFieldError } from "@/components/common/fieldValidation";

export function ModuleDefinitionForm({
  module,
  existingNames,
  currentName,
  onChange,
  showErrors = false
}: {
  module: ParameterModuleDraft;
  existingNames: readonly string[];
  currentName?: string;
  onChange: (patch: Partial<ParameterModuleDraft>) => void;
  showErrors?: boolean;
}) {
  const [nameTouched, setNameTouched] = useState(false);
  const nameError = getModuleNameError(module.name, existingNames, currentName);
  const visibleNameError = shouldShowFieldError(nameError, { touched: nameTouched, submitted: showErrors });

  return (
    <form className="param-module-def-form" onSubmit={(event) => event.preventDefault()}>
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
