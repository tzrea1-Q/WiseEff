import type { ParameterModuleDraft } from "@/powerManagementConfig";

export function ModuleDefinitionForm({
  module,
  existingNames,
  currentName,
  onChange
}: {
  module: ParameterModuleDraft;
  existingNames: readonly string[];
  currentName?: string;
  onChange: (patch: Partial<ParameterModuleDraft>) => void;
}) {
  const nameError = getModuleNameError(module.name, existingNames, currentName);

  return (
    <form className="param-module-def-form" onSubmit={(event) => event.preventDefault()}>
      <label>
        模块名称
        <input
          aria-invalid={nameError ? "true" : "false"}
          aria-label="模块名称"
          value={module.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        {nameError ? <span className="field-error">{nameError}</span> : null}
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
        责任团队
        <input
          aria-label="责任团队"
          placeholder="例如 电池算法组"
          value={module.owner}
          onChange={(event) => onChange({ owner: event.target.value })}
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
