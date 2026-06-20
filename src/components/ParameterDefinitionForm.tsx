import { migrateParameterRange } from "../parameterAdminAnalytics";
import type { ParameterValueKind } from "../powerManagementConfig";
import {
  complexEditorRows,
  getComplexParameterKindLabel,
  isComplexParameter
} from "../parameterValueKind";
import type { PowerManagementParameterTemplate, PowerManagementProject } from "../powerManagementConfig";
import { RiskPicker } from "./RiskPicker";

const NAME_RE = /^[a-z][a-z0-9_]*$/;

export function ParameterDefinitionForm({
  parameter,
  projects,
  modules,
  allParameters,
  onMetadataChange,
  onRecommendedValueChange
}: {
  parameter: PowerManagementParameterTemplate;
  projects: readonly PowerManagementProject[];
  modules: readonly string[];
  allParameters: readonly PowerManagementParameterTemplate[];
  onMetadataChange: (patch: Partial<Omit<PowerManagementParameterTemplate, "id" | "values">>) => void;
  onRecommendedValueChange: (value: string) => void;
}) {
  const range = migrateParameterRange(parameter.range);
  const firstProjectId = projects[0]?.id;
  const recommendedValue = firstProjectId ? parameter.values[firstProjectId]?.recommendedValue ?? "" : "";
  const nameError = getNameError(parameter, allParameters);
  const isComplex = isComplexParameter(parameter);
  const moduleOptions = buildModuleOptions(modules, parameter.module);

  const updateRange = (patch: { min?: string; max?: string }) => {
    const min = (patch.min ?? String(range.min ?? "")).trim();
    const max = (patch.max ?? String(range.max ?? "")).trim();
    if (!min && !max) {
      onMetadataChange({ range: "" });
      return;
    }
    if (min && max) {
      onMetadataChange({ range: `${min} - ${max}` });
      return;
    }
    onMetadataChange({ range: min || max });
  };

  return (
    <section className="shared-definition-panel" aria-label="共享参数定义">
      <div className="panel-header">
        <strong>共享参数定义</strong>
        <span>{isComplex ? "复杂配置 · 所有项目共用" : "所有项目共用"}</span>
      </div>
      <form className="param-def-form" onSubmit={(event) => event.preventDefault()}>
        <fieldset className="def-group">
          <legend>基本信息</legend>
          <div className="def-group-fields">
            <label>
              参数名
              <input aria-invalid={nameError ? "true" : "false"} aria-label="参数名" value={parameter.name} onChange={(event) => onMetadataChange({ name: event.target.value })} />
              {nameError ? <span className="field-error">{nameError}</span> : null}
            </label>
            <label>
              模块
              <select aria-label="模块" value={parameter.module} onChange={(event) => onMetadataChange({ module: event.target.value })}>
                {moduleOptions.map((moduleName) => (
                  <option key={moduleName} value={moduleName}>{moduleName}</option>
                ))}
              </select>
            </label>
            <label>
              单位
              <input aria-label="单位" value={parameter.unit} onChange={(event) => onMetadataChange({ unit: event.target.value })} />
            </label>
            <label>
              重要性
              <RiskPicker value={parameter.risk} onChange={(risk) => onMetadataChange({ risk })} />
            </label>
            <label>
              参数值类型
              <select
                aria-label="参数值类型"
                value={parameter.valueKind}
                onChange={(event) => onMetadataChange({ valueKind: event.target.value as ParameterValueKind })}
              >
                <option value="scalar">单一数值</option>
                <option value="complex">复杂配置</option>
              </select>
            </label>
          </div>
        </fieldset>
        <fieldset className="def-group">
          <legend>{isComplex ? "推荐配置" : "取值范围"}</legend>
          {isComplex ? (
            <div className="parameter-admin-complex-meta" aria-label="复杂参数摘要">
              <span className="parameter-draft-meta-pill">复杂配置</span>
              <span>{getComplexParameterKindLabel(parameter)}</span>
              <span>{complexEditorRows(recommendedValue)} 行推荐配置</span>
            </div>
          ) : null}
          <div className={isComplex ? "def-group-fields def-group-fields--stack" : "def-group-fields"}>
            <label>
              <span className="def-field-label-row">
                {isComplex ? "推荐配置" : "推荐值"}
                <span className="label-hint">ⓘ 对所有项目生效</span>
              </span>
              {isComplex ? (
                <textarea
                  aria-label="参数推荐配置"
                  className="parameter-admin-code-editor"
                  value={recommendedValue}
                  rows={complexEditorRows(recommendedValue, 8)}
                  wrap="off"
                  onChange={(event) => onRecommendedValueChange(event.target.value)}
                />
              ) : (
                <input aria-label="参数推荐值" value={recommendedValue} onChange={(event) => onRecommendedValueChange(event.target.value)} />
              )}
            </label>
            {!isComplex ? (
              <>
                <label>
                  范围最小值
                  <input aria-label="范围最小值" inputMode="decimal" value={range.min ?? ""} onChange={(event) => updateRange({ min: event.target.value })} />
                </label>
                <label>
                  范围最大值
                  <input aria-label="范围最大值" inputMode="decimal" value={range.max ?? ""} onChange={(event) => updateRange({ max: event.target.value })} />
                </label>
              </>
            ) : null}
          </div>
        </fieldset>
        <fieldset className="def-group">
          <legend>描述信息</legend>
          <div className="def-group-fields def-group-fields--stack">
            <label>
              展示描述
              <textarea value={parameter.description} onChange={(event) => onMetadataChange({ description: event.target.value })} rows={2} />
            </label>
            <label>
              参数解释
              <textarea value={parameter.explanation} onChange={(event) => onMetadataChange({ explanation: event.target.value })} rows={3} />
            </label>
            <label>
              配置格式
              <textarea
                className={isComplex ? "parameter-admin-code-editor" : undefined}
                value={parameter.configFormat}
                onChange={(event) => onMetadataChange({ configFormat: event.target.value })}
                rows={isComplex ? complexEditorRows(parameter.configFormat, 4) : 2}
                wrap={isComplex ? "off" : undefined}
              />
            </label>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

function buildModuleOptions(modules: readonly string[], currentModule: string) {
  const moduleSet = new Set(modules.map((moduleName) => moduleName.trim()).filter(Boolean));
  if (currentModule.trim()) {
    moduleSet.add(currentModule.trim());
  }
  return Array.from(moduleSet).sort((left, right) => left.localeCompare(right));
}

function getNameError(parameter: PowerManagementParameterTemplate, allParameters: readonly PowerManagementParameterTemplate[]) {
  if (!parameter.name.trim()) return "参数名不能为空";
  if (!NAME_RE.test(parameter.name)) return "只允许小写字母、数字、下划线，且首字符为字母";
  if (allParameters.some((item) => item.id !== parameter.id && item.name === parameter.name)) return "已存在同名参数";
  return null;
}
