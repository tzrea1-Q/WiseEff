import { useEffect, useMemo, useRef, useState } from "react";
import type { PageProps } from "@/app/routes";
import { KpiStrip, type KpiItem } from "@/components/KpiStrip";
import { ArchiveDebugNodeDialog } from "@/components/admin/ArchiveDebugNodeDialog";
import { DebugModuleManagementDialog } from "@/components/admin/DebugModuleManagementDialog";
import { DebugNodeBindingsDialog } from "@/components/admin/DebugNodeBindingsDialog";
import { DebugNodeEditorDialog, type DebugNodeDraft } from "@/components/admin/DebugNodeEditorDialog";
import { DebugNodeLibraryTable, type DebugNodeLibrarySearch } from "@/components/admin/DebugNodeLibraryTable";
import { useTopBarActions } from "@/components/layout";
import { bindingForProtocol } from "@/debugAdminDraft";
import { buildDebugModulesFromNodes, countDebugNodesByModule } from "@/debugAdminModules";
import type { DebugConnectionProtocol, DebugNodeProtocolBinding, DebugNodeRegistryEntry, DebugParameter } from "@/domain/debugging/types";
import {
  formatDebugAdminBindingSaveError,
  getBindingNodePathValidationError,
  normalizeBindingNodePath
} from "@/domain/debugging/bindingNodePath";
import { createDebuggingAdminClient } from "@/infrastructure/http/debuggingAdminClient";
import { wiseEffRuntimeMode, type WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import type { ParameterModuleDraft, PowerManagementParameterModule } from "@/powerManagementConfig";

function mockNodesFromParameters(parameters: readonly DebugParameter[]): DebugNodeRegistryEntry[] {
  return parameters.map((parameter) => ({
    id: parameter.id,
    projectId: parameter.projectId,
    name: parameter.name,
    description: parameter.description,
    detailedDescription: parameter.detailedDescription ?? parameter.description,
    writeFormatExample: parameter.writeFormatExample ?? "",
    writeFormatHint: parameter.writeFormatHint ?? "",
    module: parameter.module,
    enabled: parameter.enabled !== false && !parameter.archivedAt,
    bindings:
      parameter.bindings && parameter.bindings.length > 0
        ? parameter.bindings.map((binding) => ({
            protocol: binding.protocol,
            nodePath: binding.nodePath,
            accessMode: binding.accessMode,
            enabled: binding.enabled,
            notes: binding.notes
          }))
        : parameter.nodePath
          ? [{ protocol: "hdc", nodePath: parameter.nodePath, accessMode: parameter.accessMode, enabled: true }]
          : []
  }));
}

function mergeNodeBinding(
  bindings: DebugNodeProtocolBinding[],
  protocol: DebugConnectionProtocol,
  patch: Partial<DebugNodeProtocolBinding>
) {
  const current = bindingForProtocol(bindings, protocol);
  const next = bindings.filter((binding) => binding.protocol !== protocol);
  return [...next, { ...current, ...patch, protocol }];
}

export function DebuggingAdminPage({
  state,
  dispatch,
  runtimeMode = wiseEffRuntimeMode,
  debuggingAdminClient,
  apiAuthPermissions = []
}: PageProps & {
  runtimeMode?: WiseEffRuntimeMode;
  debuggingAdminClient?: ReturnType<typeof createDebuggingAdminClient>;
  apiAuthPermissions?: string[];
}) {
  const [adminNodes, setAdminNodes] = useState<DebugNodeRegistryEntry[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [saveFlash, setSaveFlash] = useState(false);
  const [nodeSearch, setNodeSearch] = useState<DebugNodeLibrarySearch>({
    q: "",
    protocol: "all",
    modules: [],
    sort: "name-asc"
  });

  const [mockDisabledNodeIds, setMockDisabledNodeIds] = useState<Set<string>>(() => new Set());
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorNodeId, setEditorNodeId] = useState<string | null>(null);
  const [bindingsNodeId, setBindingsNodeId] = useState<string | null>(null);
  const [bindingsDraft, setBindingsDraft] = useState<DebugNodeProtocolBinding[]>([]);
  const [disableNodeId, setDisableNodeId] = useState<string | null>(null);
  const [moduleDialogOpen, setModuleDialogOpen] = useState(false);
  const [adminModules, setAdminModules] = useState<PowerManagementParameterModule[]>([]);
  const editorNodeRef = useRef<DebugNodeRegistryEntry | null>(null);
  const bindingsNodeRef = useRef<DebugNodeRegistryEntry | null>(null);

  const isApiMode = runtimeMode === "api";
  const canEditAdminCatalog = !isApiMode || apiAuthPermissions.includes("debugging:admin");
  const library = useMemo(() => {
    const nodes = isApiMode ? adminNodes : mockNodesFromParameters(state.configDraft.debugParameters);
    if (isApiMode) {
      return nodes;
    }
    return nodes.map((node) => (mockDisabledNodeIds.has(node.id) ? { ...node, enabled: false } : node));
  }, [adminNodes, isApiMode, mockDisabledNodeIds, state.configDraft.debugParameters]);

  const modules = useMemo(() => {
    const existing = isApiMode ? adminModules : state.configDraft.parameterModules;
    return buildDebugModulesFromNodes(library, existing);
  }, [adminModules, isApiMode, library, state.configDraft.parameterModules]);

  useEffect(() => {
    if (!isApiMode || !debuggingAdminClient) {
      return;
    }

    let cancelled = false;
    setAdminLoading(true);
    setAdminError("");
    Promise.all([
      debuggingAdminClient.listNodes({ projectId: state.activeProjectId, includeArchived: true }),
      debuggingAdminClient.listModules()
    ])
      .then(([nodes, loadedModules]) => {
        if (cancelled) return;
        setAdminNodes(nodes);
        setAdminModules(loadedModules);
      })
      .catch(() => {
        if (!cancelled) {
          setAdminError("无法加载可调节点目录。");
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
  }, [debuggingAdminClient, isApiMode, state.activeProjectId]);

  const flashSaved = (nextStatus: string) => {
    setSaveStatus(nextStatus);
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 1500);
  };

  const replaceAdminNode = (node: DebugNodeRegistryEntry) => {
    setAdminNodes((nodes) => {
      const index = nodes.findIndex((item) => item.id === node.id);
      if (index === -1) return [...nodes, node];
      return nodes.map((item) => (item.id === node.id ? node : item));
    });
  };

  const mergeAdminNodeBindings = (nodeId: string, binding: DebugNodeProtocolBinding) => {
    setAdminNodes((nodes) =>
      nodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }
        const others = node.bindings.filter((item) => item.protocol !== binding.protocol);
        return { ...node, bindings: [...others, binding] };
      })
    );
  };

  const editorNode = useMemo(() => {
    if (!editorNodeId) return null;
    return library.find((node) => node.id === editorNodeId) ?? null;
  }, [editorNodeId, library]);
  editorNodeRef.current = editorNode;

  const bindingsNode = useMemo(() => {
    if (!bindingsNodeId) return null;
    return library.find((node) => node.id === bindingsNodeId) ?? null;
  }, [bindingsNodeId, library]);
  bindingsNodeRef.current = bindingsNode;

  useEffect(() => {
    if (!bindingsNode) {
      setBindingsDraft([]);
      return;
    }
    setBindingsDraft(bindingsNode.bindings ?? []);
  }, [bindingsNode]);

  const saveMockNode = (draft: DebugNodeDraft, existingNode?: DebugNodeRegistryEntry | null) => {
    if (existingNode) {
      dispatch({
        type: "UPDATE_DEBUG_PARAMETER",
        parameterId: existingNode.id,
        patch: {
          name: draft.name,
          description: draft.description,
          detailedDescription: draft.detailedDescription,
          writeFormatExample: draft.writeFormatExample,
          writeFormatHint: draft.writeFormatHint,
          module: draft.module
        }
      });
      setMockDisabledNodeIds((current) => {
        const next = new Set(current);
        if (draft.enabled) {
          next.delete(existingNode.id);
        } else {
          next.add(existingNode.id);
        }
        return next;
      });
      return;
    }

    dispatch({
      type: "ADD_DEBUG_PARAMETER",
      initialDraft: {
        name: draft.name,
        description: draft.description,
        detailedDescription: draft.detailedDescription,
        writeFormatExample: draft.writeFormatExample,
        writeFormatHint: draft.writeFormatHint,
        nodePath: "",
        accessMode: "RO",
        key: `debug.node.${Date.now()}`,
        module: draft.module || "Device Lab",
        currentValue: "",
        targetValue: "",
        unit: "",
        range: "",
        risk: "Low",
        status: "已同步"
      } as never
    });
  };

  const saveMockBindings = (nodeId: string, bindings: DebugNodeProtocolBinding[]) => {
    const preferred = bindingForProtocol(bindings, "hdc");
    dispatch({
      type: "UPDATE_DEBUG_PARAMETER",
      parameterId: nodeId,
      patch: {
        bindings,
        nodePath: preferred.nodePath,
        accessMode: preferred.accessMode
      } as never
    });
  };

  const saveNode = async (draft: DebugNodeDraft) => {
    const existingNode = editorNodeRef.current;
    if (isApiMode) {
      if (!debuggingAdminClient || !canEditAdminCatalog) return;
      setAdminLoading(true);
      setAdminError("");
      setSaveStatus("");
      try {
        const saved =
          editorMode === "edit" && existingNode
            ? await debuggingAdminClient.updateNode(existingNode.id, draft)
            : await debuggingAdminClient.createNode({
                projectId: state.activeProjectId ?? null,
                name: draft.name,
                description: draft.description,
                detailedDescription: draft.detailedDescription,
                writeFormatExample: draft.writeFormatExample,
                writeFormatHint: draft.writeFormatHint,
                module: draft.module,
                enabled: draft.enabled
              });
        replaceAdminNode(saved);
        setEditorMode(null);
        setEditorNodeId(null);
        flashSaved("已保存");
      } catch {
        setAdminError("保存调试节点失败。");
      } finally {
        setAdminLoading(false);
      }
      return;
    }

    saveMockNode(draft, existingNode);
    setEditorMode(null);
    setEditorNodeId(null);
    flashSaved("已保存");
  };

  const saveNodeBinding = async (protocol: DebugConnectionProtocol) => {
    const node = bindingsNodeRef.current;
    if (!node || !debuggingAdminClient || !canEditAdminCatalog) {
      return;
    }

    const binding = bindingForProtocol(bindingsDraft, protocol);
    const pathError = getBindingNodePathValidationError(binding.nodePath);
    if (pathError) {
      setAdminError(pathError);
      return;
    }

    setAdminLoading(true);
    setAdminError("");
    try {
      const saved = await debuggingAdminClient.upsertNodeBinding(node.id, protocol, {
        ...binding,
        nodePath: normalizeBindingNodePath(binding.nodePath)
      });
      mergeAdminNodeBindings(node.id, saved);
      setBindingsDraft((current) => mergeNodeBinding(current, protocol, saved));
      flashSaved("已保存 binding");
    } catch (error) {
      setAdminError(formatDebugAdminBindingSaveError(error, "保存节点 binding 失败。"));
    } finally {
      setAdminLoading(false);
    }
  };

  const archiveNodeBinding = async (protocol: DebugConnectionProtocol) => {
    const node = bindingsNodeRef.current;
    if (!node || !debuggingAdminClient || !canEditAdminCatalog) {
      return;
    }

    setAdminLoading(true);
    setAdminError("");
    try {
      const saved = await debuggingAdminClient.archiveNodeBinding(node.id, protocol);
      mergeAdminNodeBindings(node.id, saved);
      setBindingsDraft((current) => mergeNodeBinding(current, protocol, saved));
      flashSaved("已归档 binding");
    } catch {
      setAdminError("归档节点 binding 失败。");
    } finally {
      setAdminLoading(false);
    }
  };

  const saveBindingsDialog = () => {
    const node = bindingsNodeRef.current;
    if (!node) {
      return;
    }

    if (isApiMode) {
      setBindingsNodeId(null);
      return;
    }

    saveMockBindings(node.id, bindingsDraft);
    setBindingsNodeId(null);
    flashSaved("已保存");
  };

  const addDebugModule = async (draft: ParameterModuleDraft) => {
    if (isApiMode) {
      if (!debuggingAdminClient || !canEditAdminCatalog) {
        return;
      }
      setAdminLoading(true);
      setAdminError("");
      try {
        const saved = await debuggingAdminClient.createModule(draft);
        setAdminModules((current) => [...current.filter((module) => module.name !== saved.name), saved]);
        flashSaved("模块已创建");
      } catch {
        setAdminError("创建模块失败。");
      } finally {
        setAdminLoading(false);
      }
      return;
    }
    dispatch({ type: "ADD_PARAMETER_MODULE", module: draft });
    flashSaved("模块已创建");
  };

  const updateDebugModule = async (moduleName: string, patch: ParameterModuleDraft) => {
    const nextName = patch.name.trim();
    if (!nextName) {
      return;
    }

    if (isApiMode) {
      if (!debuggingAdminClient || !canEditAdminCatalog) {
        return;
      }

      setAdminLoading(true);
      setAdminError("");
      try {
        const saved = await debuggingAdminClient.updateModule(moduleName, patch);
        setAdminModules((current) => {
          const withoutOld = current.filter((module) => module.name !== moduleName && module.name !== saved.name);
          return [...withoutOld, saved];
        });
        if (saved.name !== moduleName) {
          setAdminNodes((nodes) =>
            nodes.map((node) => (node.module === moduleName ? { ...node, module: saved.name } : node))
          );
        }
        flashSaved("模块已更新");
      } catch {
        setAdminError("更新模块失败。");
      } finally {
        setAdminLoading(false);
      }
      return;
    }

    dispatch({ type: "UPDATE_PARAMETER_MODULE", moduleName, patch });
    flashSaved("模块已更新");
  };

  const deleteDebugModule = async (moduleName: string) => {
    if (countDebugNodesByModule(library, moduleName) > 0) {
      return;
    }
    if (isApiMode) {
      if (!debuggingAdminClient || !canEditAdminCatalog) {
        return;
      }
      setAdminLoading(true);
      setAdminError("");
      try {
        await debuggingAdminClient.deleteModule(moduleName);
        setAdminModules((current) => current.filter((module) => module.name !== moduleName));
        flashSaved("模块已删除");
      } catch {
        setAdminError("删除模块失败。");
      } finally {
        setAdminLoading(false);
      }
      return;
    }
    dispatch({ type: "DELETE_PARAMETER_MODULE", moduleName });
    flashSaved("模块已删除");
  };

  const openNodeEditorFromModule = (nodeId: string) => {
    setModuleDialogOpen(false);
    setEditorMode("edit");
    setEditorNodeId(nodeId);
  };

  const disableNode = async (node: DebugNodeRegistryEntry) => {
    if (isApiMode) {
      if (!debuggingAdminClient || !canEditAdminCatalog) return;
      setAdminLoading(true);
      setAdminError("");
      setSaveStatus("");
      try {
        const saved = await debuggingAdminClient.updateNode(node.id, { enabled: false });
        replaceAdminNode(saved);
        flashSaved("已禁用");
      } catch {
        setAdminError("禁用调试节点失败。");
      } finally {
        setAdminLoading(false);
      }
      return;
    }

    setMockDisabledNodeIds((current) => new Set(current).add(node.id));
    flashSaved("已禁用");
  };

  const nodeCount = library.length;
  const enabledCount = library.filter((node) => node.enabled).length;
  const onlineDevices = state.devices.filter((device) => device.status === "已连接").length;
  const kpiItems: KpiItem[] = [
    { id: "nodes", label: "可调节点", value: nodeCount },
    { id: "enabled-nodes", label: "已启用", value: enabledCount },
    { id: "online-devices", label: "在线设备", value: `${onlineDevices}/${state.devices.length}` },
    { id: "last-save", label: "最近保存", value: saveStatus || "—" }
  ];

  useTopBarActions(
    <div className="debug-admin-strip debug-admin-strip--topbar">
      <span className={`debug-admin-save-indicator${saveFlash || saveStatus ? " visible" : ""}`}>{saveStatus || "✓ 已自动保存"}</span>
    </div>,
    [saveFlash, saveStatus]
  );

  const disableTarget = disableNodeId ? library.find((node) => node.id === disableNodeId) : null;

  return (
    <div className="debug-admin-shell param-admin-shell">
      <KpiStrip items={kpiItems} />
      <main className="param-admin-main">
        {adminError ? <p className="debug-admin-error" role="alert">{adminError}</p> : null}
        {isApiMode && !canEditAdminCatalog ? <p className="debug-admin-error">缺少 debugging:admin 权限，目录仅可查看。</p> : null}
        <DebugNodeLibraryTable
          nodes={library}
          search={nodeSearch}
          onUpdateSearch={(patch) => setNodeSearch((current) => ({ ...current, ...patch }))}
          onEdit={(nodeId) => {
            setEditorMode("edit");
            setEditorNodeId(nodeId);
          }}
          onEditBindings={setBindingsNodeId}
          onDisable={setDisableNodeId}
          onCreate={() => {
            setEditorMode("create");
            setEditorNodeId(null);
          }}
          onManageModules={() => setModuleDialogOpen(true)}
          canEdit={canEditAdminCatalog}
          loading={adminLoading}
        />
      </main>

      <DebugNodeEditorDialog
        open={editorMode !== null}
        mode={editorMode === "create" ? "create" : "edit"}
        node={editorNode}
        modules={modules.map((module) => module.name)}
        loading={adminLoading}
        canEdit={canEditAdminCatalog}
        onSave={(draft) => void saveNode(draft)}
        onClose={() => {
          setEditorMode(null);
          setEditorNodeId(null);
        }}
      />

      {bindingsNode ? (
        <DebugNodeBindingsDialog
          nodeName={bindingsNode.name}
          draft={bindingsDraft}
          nodeId={bindingsNode.id}
          isApiMode={isApiMode}
          canEdit={canEditAdminCatalog}
          loading={adminLoading}
          onBindingChange={(protocol, patch) => setBindingsDraft((current) => mergeNodeBinding(current, protocol, patch))}
          onSave={saveBindingsDialog}
          onSaveBinding={(protocol) => void saveNodeBinding(protocol)}
          onArchiveBinding={(protocol) => void archiveNodeBinding(protocol)}
          onClose={() => setBindingsNodeId(null)}
        />
      ) : null}

      <ArchiveDebugNodeDialog
        open={Boolean(disableTarget)}
        nodeName={disableTarget?.name ?? ""}
        loading={adminLoading}
        onCancel={() => setDisableNodeId(null)}
        onConfirm={() => {
          if (!disableTarget) return;
          void disableNode(disableTarget);
          setDisableNodeId(null);
        }}
      />

      <DebugModuleManagementDialog
        open={moduleDialogOpen}
        modules={modules}
        nodes={library}
        onClose={() => setModuleDialogOpen(false)}
        onAddModule={addDebugModule}
        onUpdateModule={(moduleName, patch) => void updateDebugModule(moduleName, patch)}
        onDeleteModule={deleteDebugModule}
        onEditNode={openNodeEditorFromModule}
      />
    </div>
  );
}
