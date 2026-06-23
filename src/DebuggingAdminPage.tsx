import { FileText, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PageProps } from "@/app/routes";
import { KpiStrip, type KpiItem } from "@/components/KpiStrip";
import { ArchiveDebugParameterDialog } from "@/components/admin/ArchiveDebugParameterDialog";
import { CreateDebugParameterDialog } from "@/components/admin/CreateDebugParameterDialog";
import { DebugParameterBindingsDialog } from "@/components/admin/DebugParameterBindingsDialog";
import { DebugParameterDefinitionDialog } from "@/components/admin/DebugParameterDefinitionDialog";
import { DebugParameterLibraryTable } from "@/components/admin/DebugParameterLibraryTable";
import { Button } from "@/components/ui/button";
import {
  bindingForProtocol,
  draftFromDebugParameter
} from "@/debugAdminDraft";
import { parseDebugAdminSearch, useDebugAdminSearch } from "@/hooks/useDebugAdminSearch";
import type {
  DebugAdminParameterDraft,
  DebugConnectionProtocol,
  DebugParameter as DomainDebugParameter,
  DebugParameterNodeBinding
} from "@/domain/debugging/types";
import { createDebuggingAdminClient } from "@/infrastructure/http/debuggingAdminClient";
import { wiseEffRuntimeMode, type WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { serializePowerManagementConfig } from "@/powerManagementConfig";
import { useTopBarActions } from "@/components/layout";

function ConfigExportActions({ configJson, runtimeMode }: { configJson: string; runtimeMode: WiseEffRuntimeMode }) {
  const [syncMessage, setSyncMessage] = useState("导出后可手动替换 src/config/power-management.json。");
  const [saving, setSaving] = useState(false);
  const exportConfig = () => {
    const blob = new Blob([configJson], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "power-management.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setSyncMessage("JSON 已导出，可手动同步回代码配置源。");
  };

  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(configJson);
      setSyncMessage("JSON 已复制，可手动同步回代码配置源。");
    } catch {
      setSyncMessage("当前浏览器限制剪贴板写入，可直接从预览区复制 JSON。");
    }
  };

  const saveConfig = async () => {
    if (runtimeMode === "api") {
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/power-management-config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: configJson
      });
      if (!response.ok) {
        throw new Error("保存失败");
      }
      setSyncMessage("已写入 src/config/power-management.json，刷新项目后会读取最新配置。");
    } catch {
      setSyncMessage("写入失败：当前环境不支持本地保存时，请导出 JSON 后手动替换。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="config-admin-actions">
      <div className="config-actions">
        <Button type="button" onClick={saveConfig} disabled={saving}>
          <FileText size={16} />
          {saving ? "保存中" : "保存到 JSON 文件"}
        </Button>
        <Button variant="outline" type="button" onClick={exportConfig}>
          <Upload size={16} />
          导出 JSON
        </Button>
        <Button variant="outline" type="button" onClick={copyConfig}>
          <FileText size={16} />
          复制 JSON
        </Button>
      </div>
      <small className="config-sync-note">{syncMessage}</small>
    </div>
  );
}

function ConfigJsonPreviewSection({
  configJson,
  jsonExpanded,
  onToggle,
  runtimeMode
}: {
  configJson: string;
  jsonExpanded: boolean;
  onToggle: () => void;
  runtimeMode: WiseEffRuntimeMode;
}) {
  return (
    <section className="debug-admin-json-section">
      <button
        type="button"
        className="debug-admin-json-toggle"
        aria-expanded={jsonExpanded}
        onClick={onToggle}
      >
        <span>{jsonExpanded ? "▾" : "▸"} 配置源预览</span>
        <small>src/config/power-management.json</small>
      </button>
      {jsonExpanded ? (
        <div className="debug-admin-json-content">
          <pre>{configJson}</pre>
          <ConfigExportActions configJson={configJson} runtimeMode={runtimeMode} />
        </div>
      ) : null}
    </section>
  );
}

export function DebuggingAdminPage({
  state,
  dispatch,
  search: rawSearch,
  runtimeMode = wiseEffRuntimeMode,
  debuggingAdminClient,
  apiAuthPermissions = []
}: PageProps & {
  runtimeMode?: WiseEffRuntimeMode;
  debuggingAdminClient?: ReturnType<typeof createDebuggingAdminClient>;
  apiAuthPermissions?: string[];
}) {
  const [adminParameters, setAdminParameters] = useState<DomainDebugParameter[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [saveFlash, setSaveFlash] = useState(false);
  const [jsonExpanded, setJsonExpanded] = useState(false);

  const [definitionId, setDefinitionId] = useState<string | null>(null);
  const [bindingsId, setBindingsId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [definitionDraft, setDefinitionDraft] = useState<DebugAdminParameterDraft | null>(null);
  const [bindingsDraft, setBindingsDraft] = useState<DebugAdminParameterDraft | null>(null);
  const definitionDraftRef = useRef(definitionDraft);
  const bindingsDraftRef = useRef(bindingsDraft);
  definitionDraftRef.current = definitionDraft;
  bindingsDraftRef.current = bindingsDraft;

  const isApiMode = runtimeMode === "api";
  const canEditAdminCatalog = !isApiMode || apiAuthPermissions.includes("debugging:admin");
  const urlSearch = useDebugAdminSearch();
  const search = rawSearch ? parseDebugAdminSearch(rawSearch) : urlSearch.search;
  const updateSearch = urlSearch.updateSearch;
  const library = isApiMode ? adminParameters : state.configDraft.debugParameters;
  const configJson = useMemo(() => serializePowerManagementConfig(state.configDraft), [state.configDraft]);

  useEffect(() => {
    if (!isApiMode || !debuggingAdminClient) {
      return;
    }

    let cancelled = false;
    setAdminLoading(true);
    setAdminError("");
    debuggingAdminClient
      .listParameters({ includeArchived: true })
      .then((parameters) => {
        if (cancelled) return;
        setAdminParameters(parameters);
      })
      .catch(() => {
        if (!cancelled) {
          setAdminError("无法加载调试参数目录。");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAdminLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debuggingAdminClient, isApiMode]);

  const flashSaved = (nextStatus: string) => {
    setSaveStatus(nextStatus);
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 1500);
  };

  const toMockDebugDraft = (draft: DebugAdminParameterDraft) => {
    const hdcBinding = bindingForProtocol(draft.bindings, "hdc");
    return {
      name: draft.name,
      key: draft.key,
      description: draft.description,
      module: draft.module,
      currentValue: draft.currentValue,
      targetValue: draft.targetValue,
      unit: draft.unit,
      range: draft.range,
      risk: draft.risk,
      status: "已同步" as const,
      nodePath: hdcBinding.nodePath || draft.nodePath,
      accessMode: hdcBinding.accessMode || draft.accessMode,
      valueKind: draft.valueKind,
      valueFormat: draft.valueFormat,
      normalizationMode: draft.normalizationMode,
      maxValueBytes: draft.maxValueBytes ?? null
    };
  };

  const replaceAdminParameter = (parameter: DomainDebugParameter) => {
    setAdminParameters((parameters) => {
      const index = parameters.findIndex((item) => item.id === parameter.id);
      if (index === -1) return [...parameters, parameter];
      return parameters.map((item) => (item.id === parameter.id ? parameter : item));
    });
  };

  const setDefinitionDraftPatch = (patch: Partial<DebugAdminParameterDraft>) => {
    setDefinitionDraft((draft) => (draft ? { ...draft, ...patch } : draft));
    setSaveStatus("");
  };

  const setBindingsDraftPatch = (protocol: DebugConnectionProtocol, patch: Partial<DebugParameterNodeBinding>) => {
    const applyPatch = (draft: DebugAdminParameterDraft | null) => {
      if (!draft) return draft;
      const currentBinding = bindingForProtocol(draft.bindings, protocol);
      const nextBinding = { ...currentBinding, ...patch, protocol };
      const otherBindings = draft.bindings.filter((binding) => binding.protocol !== protocol);
      return { ...draft, bindings: [...otherBindings, nextBinding] };
    };
    setBindingsDraft((draft) => applyPatch(draft));
    setSaveStatus("");
  };

  const openDefinitionDialog = (parameterId: string) => {
    const parameter = library.find((item) => item.id === parameterId);
    if (!parameter) return;
    const draft = draftFromDebugParameter(parameter as DomainDebugParameter);
    setDefinitionId(parameterId);
    setDefinitionDraft(draft);
    setSaveStatus("");
  };

  const openBindingsDialog = (parameterId: string) => {
    const parameter = library.find((item) => item.id === parameterId);
    if (!parameter) return;
    const draft = draftFromDebugParameter(parameter as DomainDebugParameter);
    setBindingsId(parameterId);
    setBindingsDraft(draft);
    setSaveStatus("");
  };

  const saveAdminParameter = async (draft: DebugAdminParameterDraft | null) => {
    if (!draft) return;
    if (isApiMode) {
      if (!debuggingAdminClient || !canEditAdminCatalog) return;
      setAdminLoading(true);
      setAdminError("");
      setSaveStatus("");
      try {
        const saved = draft.id
          ? await debuggingAdminClient.updateParameter(draft.id, draft)
          : await debuggingAdminClient.createParameter(draft);
        replaceAdminParameter(saved);
        setDefinitionDraft(draftFromDebugParameter(saved));
        flashSaved("已保存");
      } catch {
        setAdminError("保存调试参数失败。");
      } finally {
        setAdminLoading(false);
      }
      return;
    }

    if (!draft.id) {
      dispatch({ type: "ADD_DEBUG_PARAMETER", initialDraft: toMockDebugDraft(draft) });
    } else {
      dispatch({ type: "UPDATE_DEBUG_PARAMETER", parameterId: draft.id, patch: toMockDebugDraft(draft) });
    }
    flashSaved("已保存");
  };

  const saveBindingsToMockState = (draft: DebugAdminParameterDraft) => {
    if (!draft.id) return;
    const hdcBinding = bindingForProtocol(draft.bindings, "hdc");
    dispatch({
      type: "UPDATE_DEBUG_PARAMETER",
      parameterId: draft.id,
      patch: {
        nodePath: hdcBinding.nodePath,
        accessMode: hdcBinding.accessMode
      }
    });
    flashSaved("已保存");
  };

  const saveAdminBinding = async (protocol: DebugConnectionProtocol) => {
    const activeBindingsDraft = bindingsDraftRef.current;
    if (!activeBindingsDraft) return;
    if (isApiMode) {
      if (!debuggingAdminClient || !activeBindingsDraft.id || !canEditAdminCatalog) return;
      setAdminLoading(true);
      setAdminError("");
      setSaveStatus("");
      try {
        const binding = await debuggingAdminClient.upsertBinding(
          activeBindingsDraft.id,
          protocol,
          bindingForProtocol(activeBindingsDraft.bindings, protocol)
        );
        setBindingsDraft((draft) => {
          if (!draft) return draft;
          return {
            ...draft,
            bindings: [...draft.bindings.filter((item) => item.protocol !== protocol), binding]
          };
        });
        setAdminParameters((parameters) =>
          parameters.map((parameter) =>
            parameter.id === activeBindingsDraft.id
              ? { ...parameter, bindings: [...(parameter.bindings ?? []).filter((item) => item.protocol !== protocol), binding] }
              : parameter
          )
        );
        flashSaved("已保存");
      } catch {
        setAdminError(`保存 ${protocol.toUpperCase()} 绑定失败。`);
      } finally {
        setAdminLoading(false);
      }
      return;
    }

    saveBindingsToMockState(activeBindingsDraft);
  };

  const saveAllAdminBindings = async () => {
    await saveAdminBinding("hdc");
    await saveAdminBinding("adb");
  };

  const archiveAdminBinding = async (protocol: DebugConnectionProtocol) => {
    const activeBindingsDraft = bindingsDraftRef.current;
    if (!activeBindingsDraft) return;
    if (isApiMode) {
      if (!debuggingAdminClient || !activeBindingsDraft.id || !canEditAdminCatalog) return;
      setAdminLoading(true);
      setAdminError("");
      setSaveStatus("");
      try {
        const binding = await debuggingAdminClient.archiveBinding(activeBindingsDraft.id, protocol);
        setBindingsDraft((draft) => {
          if (!draft) return draft;
          return {
            ...draft,
            bindings: [...draft.bindings.filter((item) => item.protocol !== protocol), binding]
          };
        });
        setAdminParameters((parameters) =>
          parameters.map((parameter) =>
            parameter.id === activeBindingsDraft.id
              ? { ...parameter, bindings: [...(parameter.bindings ?? []).filter((item) => item.protocol !== protocol), binding] }
              : parameter
          )
        );
        flashSaved("已归档");
      } catch {
        setAdminError(`归档 ${protocol.toUpperCase()} 绑定失败。`);
      } finally {
        setAdminLoading(false);
      }
      return;
    }
  };

  const archiveAdminParameter = async (parameter: DomainDebugParameter) => {
    if (isApiMode) {
      if (!debuggingAdminClient || !canEditAdminCatalog) return;
      setAdminLoading(true);
      setAdminError("");
      setSaveStatus("");
      try {
        const archived = await debuggingAdminClient.archiveParameter(parameter.id, "Archived from debugging admin.");
        replaceAdminParameter(archived);
        setDefinitionDraft((draft) => (draft?.id === archived.id ? draftFromDebugParameter(archived) : draft));
        setBindingsDraft((draft) => (draft?.id === archived.id ? draftFromDebugParameter(archived) : draft));
        flashSaved("已归档");
      } catch {
        setAdminError("归档调试参数失败。");
      } finally {
        setAdminLoading(false);
      }
      return;
    }

    dispatch({ type: "DELETE_DEBUG_PARAMETER", parameterId: parameter.id });
    flashSaved("已归档");
  };

  const createParameter = async (draft: DebugAdminParameterDraft) => {
    if (isApiMode) {
      if (!debuggingAdminClient || !canEditAdminCatalog) return;
      setAdminLoading(true);
      setAdminError("");
      setSaveStatus("");
      try {
        const created = await debuggingAdminClient.createParameter(draft);
        replaceAdminParameter(created);
        setDefinitionId(created.id);
        setDefinitionDraft(draftFromDebugParameter(created));
        setCreateOpen(false);
        flashSaved("已保存");
      } catch {
        setAdminError("保存调试参数失败。");
      } finally {
        setAdminLoading(false);
      }
      return;
    }

    dispatch({ type: "ADD_DEBUG_PARAMETER", initialDraft: toMockDebugDraft(draft) });
    setCreateOpen(false);
    flashSaved("已保存");
  };

  const parameterCount = library.length;
  const highRiskCount = library.filter((parameter) => parameter.risk === "High").length;
  const onlineDevices = state.devices.filter((device) => device.status === "已连接").length;
  const kpiItems: KpiItem[] = [
    { id: "params", label: "可调参数", value: parameterCount },
    {
      id: "risk",
      label: "高风险",
      value: highRiskCount,
      tone: "warning",
      interactive: highRiskCount > 0,
      onClick: () => updateSearch({ risk: "high" })
    },
    { id: "online-devices", label: "在线设备", value: `${onlineDevices}/${state.devices.length}` },
    { id: "last-save", label: "最近保存", value: saveStatus || "—" }
  ];

  useTopBarActions(
    <div className="debug-admin-strip debug-admin-strip--topbar">
      <span className="debug-admin-stat">可调参数 <strong>{parameterCount}</strong></span>
      <span className="debug-admin-stat">高风险 <strong>{highRiskCount}</strong></span>
      <span className="debug-admin-stat">在线设备 <strong>{onlineDevices}/{state.devices.length}</strong></span>
      <span className={`debug-admin-save-indicator${saveFlash || saveStatus ? " visible" : ""}`}>{saveStatus || "✓ 已自动保存"}</span>
    </div>,
    [highRiskCount, onlineDevices, parameterCount, saveFlash, saveStatus, state.devices.length]
  );

  const archiveTarget = archiveId ? library.find((parameter) => parameter.id === archiveId) : null;
  const bindingsParameter = bindingsId ? library.find((parameter) => parameter.id === bindingsId) : null;

  return (
    <div className="debug-admin-shell param-admin-shell">
      <KpiStrip items={kpiItems} />
      <main className="param-admin-main">
        {adminError ? <p className="debug-admin-error" role="alert">{adminError}</p> : null}
        {isApiMode && !canEditAdminCatalog ? <p className="debug-admin-error">缺少 debugging:admin 权限，目录仅可查看。</p> : null}
        <DebugParameterLibraryTable
          parameters={library}
          runtimeMode={runtimeMode}
          search={search}
          onUpdateSearch={updateSearch}
          onEditDefinition={openDefinitionDialog}
          onEditBindings={openBindingsDialog}
          onArchive={setArchiveId}
          onCreate={() => setCreateOpen(true)}
          canEdit={canEditAdminCatalog}
          loading={adminLoading}
        />
      </main>

      {definitionDraft && definitionId ? (
        <DebugParameterDefinitionDialog
          draft={definitionDraft}
          isApiMode={isApiMode}
          canEdit={canEditAdminCatalog}
          loading={adminLoading}
          onDraftChange={setDefinitionDraftPatch}
          onSave={() => void saveAdminParameter(definitionDraftRef.current)}
          onClose={() => {
            setDefinitionId(null);
            setDefinitionDraft(null);
          }}
        />
      ) : null}

      {bindingsDraft && bindingsId ? (
        <DebugParameterBindingsDialog
          parameterName={bindingsParameter?.name ?? bindingsDraft.name}
          draft={bindingsDraft.bindings}
          parameterId={bindingsDraft.id ?? ""}
          isApiMode={isApiMode}
          canEdit={canEditAdminCatalog}
          loading={adminLoading}
          onBindingChange={setBindingsDraftPatch}
          onSave={() => void saveAllAdminBindings()}
          onSaveBinding={(protocol) => void saveAdminBinding(protocol)}
          onArchiveBinding={(protocol) => void archiveAdminBinding(protocol)}
          onClose={() => {
            setBindingsId(null);
            setBindingsDraft(null);
          }}
        />
      ) : null}

      <CreateDebugParameterDialog
        open={createOpen}
        isApiMode={isApiMode}
        canEdit={canEditAdminCatalog}
        loading={adminLoading}
        existingParameters={library}
        onCreate={(draft) => void createParameter(draft)}
        onClose={() => setCreateOpen(false)}
      />

      <ArchiveDebugParameterDialog
        open={Boolean(archiveTarget)}
        parameterName={archiveTarget?.name ?? ""}
        loading={adminLoading}
        onCancel={() => setArchiveId(null)}
        onConfirm={() => {
          if (!archiveTarget) return;
          void archiveAdminParameter(archiveTarget as DomainDebugParameter);
          setArchiveId(null);
        }}
      />

      {!isApiMode ? (
        <ConfigJsonPreviewSection
          configJson={configJson}
          jsonExpanded={jsonExpanded}
          onToggle={() => setJsonExpanded((value) => !value)}
          runtimeMode={runtimeMode}
        />
      ) : null}
    </div>
  );
}
