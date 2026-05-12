import { useEffect, useMemo, useState } from "react";
import type { PowerManagementRisk } from "../powerManagementConfig";
import { RiskPicker } from "./RiskPicker";

export interface CreateParameterDraft {
  name: string;
  module: string;
  unit: string;
  risk: PowerManagementRisk;
  description: string;
}

export function CreateParameterDialog({
  open,
  existingModules,
  existingNames,
  onConfirm,
  onCancel
}: {
  open: boolean;
  existingModules: readonly string[];
  existingNames: readonly string[];
  onConfirm: (draft: CreateParameterDraft) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [module, setModule] = useState("");
  const [customModule, setCustomModule] = useState("");
  const [unit, setUnit] = useState("");
  const [risk, setRisk] = useState<PowerManagementRisk>("Medium");
  const [description, setDescription] = useState("");
  const [showNewModule, setShowNewModule] = useState(false);

  const sortedModules = useMemo(() => [...new Set(existingModules)].sort(), [existingModules]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, open]);

  useEffect(() => {
    if (open) {
      setName("");
      setModule(sortedModules[0] ?? "");
      setCustomModule("");
      setUnit("");
      setRisk("Medium");
      setDescription("");
      setShowNewModule(false);
    }
  }, [open, sortedModules]);

  if (!open) return null;

  const NAME_RE = /^[a-z][a-z0-9_]*$/;
  const resolvedModule = showNewModule ? customModule.trim() : module;
  const nameError = !name.trim()
    ? "参数名不能为空"
    : !NAME_RE.test(name)
      ? "只允许小写字母、数字、下划线，且首字符为字母"
      : existingNames.includes(name)
        ? "已存在同名参数"
        : null;
  const moduleError = !resolvedModule ? "模块不能为空" : null;
  const canSubmit = !nameError && !moduleError;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onConfirm({ name, module: resolvedModule, unit, risk, description });
  };

  return (
    <div aria-labelledby="create-parameter-title" aria-modal="true" className="modal-backdrop" role="dialog">
      <form className="confirm-dialog create-parameter-dialog" onSubmit={handleSubmit}>
        <h2 id="create-parameter-title">新增参数</h2>
        <div className="create-param-fields">
          <label>
            参数名 <span className="required">*</span>
            <input
              aria-label="参数名"
              aria-invalid={name && nameError ? "true" : undefined}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如 battery_temp_limit_c"
              autoFocus
            />
            {name && nameError ? <span className="field-error">{nameError}</span> : null}
          </label>
          <label>
            模块 <span className="required">*</span>
            {showNewModule ? (
              <>
                <input
                  aria-label="新模块名称"
                  value={customModule}
                  onChange={(event) => setCustomModule(event.target.value)}
                  placeholder="输入新模块名称"
                />
                <button className="link-button" type="button" onClick={() => setShowNewModule(false)}>
                  选择已有模块
                </button>
              </>
            ) : (
              <>
                <select aria-label="模块" value={module} onChange={(event) => setModule(event.target.value)}>
                  {sortedModules.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <button className="link-button" type="button" onClick={() => setShowNewModule(true)}>
                  + 创建新模块
                </button>
              </>
            )}
          </label>
          <label>
            单位
            <input aria-label="单位" value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="例如 mA, °C, %" />
          </label>
          <label>
            重要性
            <RiskPicker value={risk} onChange={setRisk} />
          </label>
          <label className="wide">
            描述
            <textarea
              aria-label="描述"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              placeholder="简要说明参数用途"
            />
          </label>
        </div>
        <div className="dialog-actions">
          <button className="button subtle" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="button primary" type="submit" disabled={!canSubmit}>
            创建参数
          </button>
        </div>
      </form>
    </div>
  );
}
