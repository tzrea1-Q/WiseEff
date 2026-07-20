import { useEffect, useMemo, useState } from "react";
import { AlertCircle, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";

import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import {
  EMPTY_PARAMETER_MODULE_REGISTRY,
  type ModuleImportance,
  type ModuleMatchKind,
  type ParameterModuleRegistry
} from "@/domain/parameter-topology/moduleRegistry";
import { createHttpParameterModuleRegistryRepository } from "@/infrastructure/http/parameterModuleRegistryClient";

export type UnmappedDriverHint = {
  driverModule: string;
  bindingCount: number;
};

export type ParameterModuleMappingPanelProps = {
  canAdmin?: boolean;
  repository?: ParameterModuleRegistryRepository;
  /**
   * Drivers observed in the org (e.g. from parameter specs).
   * The panel filters out those already covered by a driver mapping.
   */
  observedDrivers?: UnmappedDriverHint[];
};

const importanceOptions: Array<{ value: ModuleImportance; label: string }> = [
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" }
];

const matchKindOptions: Array<{ value: ModuleMatchKind; label: string }> = [
  { value: "driver", label: "驱动" },
  { value: "compatible", label: "compatible" },
  { value: "instance", label: "器件实例" }
];

/**
 * Admin surface for the additive module registry:
 * maintain business modules + driver/compatible/instance mappings,
 * and surface unmapped drivers as a pending queue.
 */
export function ParameterModuleMappingPanel({
  canAdmin = false,
  repository,
  observedDrivers = []
}: ParameterModuleMappingPanelProps) {
  const client = useMemo(
    () => repository ?? createHttpParameterModuleRegistryRepository(),
    [repository]
  );
  const [registry, setRegistry] = useState<ParameterModuleRegistry>(EMPTY_PARAMETER_MODULE_REGISTRY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moduleName, setModuleName] = useState("");
  const [moduleImportance, setModuleImportance] = useState<ModuleImportance>("medium");
  const [mappingModuleId, setMappingModuleId] = useState("");
  const [matchKind, setMatchKind] = useState<ModuleMatchKind>("driver");
  const [matchValue, setMatchValue] = useState("");
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeNotice, setRecomputeNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    client
      .getRegistry()
      .then((next) => {
        if (cancelled) return;
        setRegistry(next);
        setMappingModuleId((current) => current || next.modules[0]?.id || "");
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "无法加载模块注册表。");
        setRegistry(EMPTY_PARAMETER_MODULE_REGISTRY);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const unmappedDrivers = useMemo(() => {
    const mapped = new Set(
      registry.mappings
        .filter((mapping) => mapping.matchKind === "driver")
        .map((mapping) => mapping.matchValue.trim().toLocaleLowerCase())
    );
    return observedDrivers.filter(
      (hint) => !mapped.has(hint.driverModule.trim().toLocaleLowerCase())
    );
  }, [observedDrivers, registry.mappings]);

  const selectedModuleName =
    registry.modules.find((module) => module.id === mappingModuleId)?.name ?? null;

  const createModule = async () => {
    if (!canAdmin || !moduleName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await client.createModule({
        name: moduleName.trim(),
        importance: moduleImportance
      });
      setRegistry(next);
      setModuleName("");
      if (!mappingModuleId && next.modules[0]) setMappingModuleId(next.modules[0].id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建模块失败。");
    } finally {
      setBusy(false);
    }
  };

  const removeModule = async (moduleId: string) => {
    if (!canAdmin) return;
    setBusy(true);
    setError(null);
    try {
      const next = await client.deleteModule(moduleId);
      setRegistry(next);
      if (mappingModuleId === moduleId) {
        setMappingModuleId(next.modules[0]?.id ?? "");
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除模块失败。");
    } finally {
      setBusy(false);
    }
  };

  const createMapping = async () => {
    if (!canAdmin || !mappingModuleId || !matchValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await client.createMapping({
        moduleId: mappingModuleId,
        matchKind,
        matchValue: matchValue.trim()
      });
      setRegistry(next);
      setMatchValue("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建映射失败。");
    } finally {
      setBusy(false);
    }
  };

  const removeMapping = async (mappingId: string) => {
    if (!canAdmin) return;
    setBusy(true);
    setError(null);
    try {
      const next = await client.deleteMapping(mappingId);
      setRegistry(next);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除映射失败。");
    } finally {
      setBusy(false);
    }
  };

  const mapUnmappedDriver = async (driverModule: string) => {
    if (!canAdmin || !mappingModuleId) return;
    setMatchKind("driver");
    setMatchValue(driverModule);
    setBusy(true);
    setError(null);
    try {
      const next = await client.createMapping({
        moduleId: mappingModuleId,
        matchKind: "driver",
        matchValue: driverModule
      });
      setRegistry(next);
      setMatchValue("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "映射驱动失败。");
    } finally {
      setBusy(false);
    }
  };

  const recomputeBindings = async () => {
    if (!canAdmin) return;
    setRecomputing(true);
    setError(null);
    setRecomputeNotice(null);
    try {
      const result = await client.recomputeBindings();
      setRecomputeNotice(`已重算模块归属，更新 ${result.updated} 个参数绑定。`);
    } catch (recomputeError) {
      setError(
        recomputeError instanceof Error ? recomputeError.message : "重算模块归属失败。"
      );
    } finally {
      setRecomputing(false);
    }
  };

  if (loading) {
    return (
      <section className="parameter-module-mapping-panel" aria-label="模块映射管理" aria-busy="true">
        <p role="status">
          <LoaderCircle className="dts-status-icon dts-status-icon--spin" size={16} strokeWidth={2} aria-hidden="true" />
          正在加载模块注册表…
        </p>
      </section>
    );
  }

  return (
    <section className="parameter-module-mapping-panel" aria-label="模块映射管理">
      <header>
        <h3>模块映射管理</h3>
        <p>维护业务模块，并把 DTS 驱动 / compatible / 器件实例映射到模块。未映射驱动进入待处理队列。</p>
        {canAdmin ? (
          <div
            className="parameter-module-mapping-panel__actions"
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "8px 12px",
              marginTop: 8
            }}
          >
            <button
              type="button"
              className="button"
              disabled={busy || recomputing}
              onClick={() => void recomputeBindings()}
            >
              <RefreshCw
                className={recomputing ? "dts-status-icon dts-status-icon--spin" : undefined}
                size={14}
                strokeWidth={2}
                aria-hidden="true"
              />
              重算模块归属
            </button>
            <small>映射变更后，按新映射重算并写回参数绑定的模块归属。</small>
          </div>
        ) : null}
      </header>

      {recomputeNotice ? <p role="status">{recomputeNotice}</p> : null}

      {error ? (
        <p role="alert">
          <AlertCircle size={15} strokeWidth={2} aria-hidden="true" /> {error}
        </p>
      ) : null}

      <div className="parameter-module-mapping-panel__grid">
        <section aria-labelledby="module-list-title">
          <h4 id="module-list-title">业务模块</h4>
          <ul>
            {registry.modules.map((module) => (
              <li key={module.id}>
                <strong>{module.name}</strong>
                <small>重要性：{module.importance}</small>
                {canAdmin ? (
                  <button
                    type="button"
                    className="button subtle"
                    disabled={busy}
                    aria-label={`删除模块 ${module.name}`}
                    onClick={() => void removeModule(module.id)}
                  >
                    <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                    删除
                  </button>
                ) : null}
              </li>
            ))}
            {registry.modules.length === 0 ? <li>尚未创建业务模块。</li> : null}
          </ul>
          {canAdmin ? (
            <div className="parameter-module-mapping-panel__form">
              <label>
                模块名称
                <input
                  aria-label="模块名称"
                  value={moduleName}
                  onChange={(event) => setModuleName(event.target.value)}
                />
              </label>
              <label>
                重要性
                <select
                  aria-label="模块重要性"
                  value={moduleImportance}
                  onChange={(event) => setModuleImportance(event.target.value as ModuleImportance)}
                >
                  {importanceOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="button" disabled={busy || !moduleName.trim()} onClick={() => void createModule()}>
                <Plus size={14} strokeWidth={2} aria-hidden="true" />
                创建模块
              </button>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="mapping-list-title">
          <h4 id="mapping-list-title">映射规则</h4>
          <ul>
            {registry.mappings.map((mapping) => {
              const moduleNameLabel = registry.modules.find((module) => module.id === mapping.moduleId)?.name ?? mapping.moduleId;
              return (
                <li key={mapping.id}>
                  <code>{mapping.matchKind}:{mapping.matchValue}</code>
                  <span>→ {moduleNameLabel}</span>
                  {canAdmin ? (
                    <button
                      type="button"
                      className="button subtle"
                      disabled={busy}
                      aria-label={`删除映射 ${mapping.matchKind}:${mapping.matchValue}`}
                      onClick={() => void removeMapping(mapping.id)}
                    >
                      <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                      删除
                    </button>
                  ) : null}
                </li>
              );
            })}
            {registry.mappings.length === 0 ? <li>尚未配置映射规则。</li> : null}
          </ul>
          {canAdmin ? (
            <div className="parameter-module-mapping-panel__form">
              <label>
                目标模块
                <select
                  aria-label="目标模块"
                  value={mappingModuleId}
                  onChange={(event) => setMappingModuleId(event.target.value)}
                >
                  <option value="">选择模块</option>
                  {registry.modules.map((module) => (
                    <option key={module.id} value={module.id}>{module.name}</option>
                  ))}
                </select>
              </label>
              <label>
                匹配类型
                <select
                  aria-label="匹配类型"
                  value={matchKind}
                  onChange={(event) => setMatchKind(event.target.value as ModuleMatchKind)}
                >
                  {matchKindOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                匹配值
                <input
                  aria-label="匹配值"
                  value={matchValue}
                  placeholder="例如 sc8562"
                  onChange={(event) => setMatchValue(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="button"
                disabled={busy || !mappingModuleId || !matchValue.trim()}
                onClick={() => void createMapping()}
              >
                <Plus size={14} strokeWidth={2} aria-hidden="true" />
                添加映射
              </button>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="unmapped-queue-title">
          <h4 id="unmapped-queue-title">未映射待处理</h4>
          {unmappedDrivers.length === 0 ? (
            <p>当前没有未映射驱动提示。</p>
          ) : (
            <ul>
              {unmappedDrivers.map((hint) => (
                <li key={hint.driverModule}>
                  <code>{hint.driverModule}</code>
                  <small>{hint.bindingCount} 个参数</small>
                  {canAdmin ? (
                    <button
                      type="button"
                      className="button subtle"
                      disabled={busy || !mappingModuleId}
                      onClick={() => void mapUnmappedDriver(hint.driverModule)}
                    >
                      {selectedModuleName
                        ? `映射到「${selectedModuleName}」`
                        : "映射到当前模块"}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
