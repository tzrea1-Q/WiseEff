import { useCallback, useEffect, useMemo, useState } from "react";

import { DebugNodeEditorDialog, type DebugNodeDraft } from "@/components/admin/DebugNodeEditorDialog";
import { ReloadBindingEditorDialog, type ReloadBindingDraft } from "@/components/admin/ReloadBindingEditorDialog";
import { buildModuleSelectOptions } from "@/debugAdminModules";
import { nodeBindingStatus, nodeBindingStatusLabel } from "@/debugAdminDraft";
import type { DebugNodeRegistryEntry, ParameterReloadBinding } from "@/domain/debugging/types";
import {
  formatDebugAdminBindingSaveError,
  getBindingNodePathValidationError,
  normalizeBindingNodePath
} from "@/domain/debugging/bindingNodePath";
import type { createDebuggingAdminClient } from "@/infrastructure/http/debuggingAdminClient";
import type { ParameterReloadTargetDto } from "@/infrastructure/http/debuggingDtos";

export type DebugAdminCatalogView = "legacy" | "nodes" | "reload-bindings";

type DebugAdminSplitCatalogProps = {
  view: DebugAdminCatalogView;
  projectId?: string;
  client?: ReturnType<typeof createDebuggingAdminClient>;
  canEdit: boolean;
};

export function DebugAdminSplitCatalog({ view, projectId, client, canEdit }: DebugAdminSplitCatalogProps) {
  const [nodes, setNodes] = useState<DebugNodeRegistryEntry[]>([]);
  const [moduleNames, setModuleNames] = useState<string[]>([]);
  const [bindings, setBindings] = useState<ParameterReloadBinding[]>([]);
  const [reloadCandidates, setReloadCandidates] = useState<ParameterReloadTargetDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [nodeDialog, setNodeDialog] = useState<{ mode: "create" | "edit"; node?: DebugNodeRegistryEntry } | null>(null);
  const [bindingDialog, setBindingDialog] = useState<{ mode: "create" | "edit"; binding?: ParameterReloadBinding } | null>(null);

  const reloadCatalog = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!client || view === "legacy") {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    const request =
      view === "nodes"
        ? Promise.all([
            client.listNodes({ projectId, includeArchived: true }),
            client.listModules()
          ])
        : client.listReloadBindings({ projectId });

    request
      .then((items) => {
        if (cancelled) return;
        if (view === "nodes") {
          const [loadedNodes, loadedModules] = items as [DebugNodeRegistryEntry[], { name: string }[]];
          setNodes(loadedNodes);
          setModuleNames(buildModuleSelectOptions([
            ...loadedModules.map((module) => module.name),
            ...loadedNodes.map((node) => node.module)
          ]));
        } else {
          setBindings(items as ParameterReloadBinding[]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(view === "nodes" ? "无法加载节点注册表。" : "无法加载参数重载绑定。");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, projectId, refreshKey, view]);

  useEffect(() => {
    if (!client || !bindingDialog || !projectId) {
      return;
    }

    let cancelled = false;
    setCandidatesLoading(true);
    client
      .listReloadTargetCandidates({ projectId })
      .then((items) => {
        if (!cancelled) {
          setReloadCandidates(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReloadCandidates([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCandidatesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bindingDialog, client, projectId]);

  const saveNode = async (draft: DebugNodeDraft) => {
    if (!client) {
      return;
    }

    setSaveLoading(true);
    setError("");
    try {
      if (nodeDialog?.mode === "edit" && nodeDialog.node) {
        await client.updateNode(nodeDialog.node.id, draft);
      } else {
        await client.createNode({
          projectId: projectId ?? null,
          name: draft.name,
          description: draft.description,
          detailedDescription: draft.detailedDescription,
          writeFormatExample: draft.writeFormatExample,
          writeFormatHint: draft.writeFormatHint,
          module: draft.module,
          enabled: draft.enabled
        });
      }
      setNodeDialog(null);
      reloadCatalog();
    } catch {
      setError("保存节点失败，请稍后重试。");
    } finally {
      setSaveLoading(false);
    }
  };

  const saveBinding = async (draft: ReloadBindingDraft) => {
    if (!client || !projectId) {
      return;
    }

    const pathError = getBindingNodePathValidationError(draft.nodePath);
    if (pathError) {
      setError(pathError);
      return;
    }

    setSaveLoading(true);
    setError("");
    try {
      await client.upsertReloadBinding({
        projectId,
        parameterDefinitionId: draft.parameterDefinitionId,
        protocol: draft.protocol,
        nodePath: normalizeBindingNodePath(draft.nodePath),
        accessMode: draft.accessMode,
        enabled: draft.enabled,
        notes: draft.notes.trim() ? draft.notes.trim() : null
      });
      setBindingDialog(null);
      reloadCatalog();
    } catch (error) {
      setError(formatDebugAdminBindingSaveError(error, "保存重载绑定失败，请稍后重试。"));
    } finally {
      setSaveLoading(false);
    }
  };

  const nodeModuleOptions = useMemo(
    () => buildModuleSelectOptions([...moduleNames, ...nodes.map((node) => node.module)]),
    [moduleNames, nodes]
  );

  if (view === "legacy") {
    return null;
  }

  if (loading) {
    return <p className="debug-admin-note">正在加载{view === "nodes" ? "节点注册表" : "参数重载绑定"}…</p>;
  }

  const panelActions = canEdit ? (
    <div className="debug-admin-split-actions">
      <button
        type="button"
        className="button subtle"
        onClick={() => {
          if (view === "nodes") {
            setNodeDialog({ mode: "create" });
          } else {
            setBindingDialog({ mode: "create" });
          }
        }}
      >
        {view === "nodes" ? "创建节点" : "创建绑定"}
      </button>
    </div>
  ) : null;

  if (view === "nodes") {
    return (
      <>
        <section className="debug-admin-split-panel" aria-label="节点注册表">
          <p className="debug-admin-note">节点注册表独立于参数管理库，仅描述设备路径、协议与访问模式。</p>
          {panelActions}
          {error ? <p className="debug-admin-error">{error}</p> : null}
          <table className="debug-admin-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>HDC</th>
                <th>ADB</th>
                <th>状态</th>
                {canEdit ? <th>操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <tr key={node.id}>
                  <td>{node.name}</td>
                  <td>{nodeBindingStatusLabel(nodeBindingStatus(node.bindings, "hdc"))}</td>
                  <td>{nodeBindingStatusLabel(nodeBindingStatus(node.bindings, "adb"))}</td>
                  <td>{node.enabled ? "启用" : "禁用"}</td>
                  {canEdit ? (
                    <td>
                      <button type="button" className="button subtle param-admin-row-action" onClick={() => setNodeDialog({ mode: "edit", node })}>
                        编辑
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {nodes.length === 0 ? <p className="debug-admin-note">暂无节点条目。</p> : null}
        </section>

        <DebugNodeEditorDialog
          open={Boolean(nodeDialog)}
          mode={nodeDialog?.mode ?? "create"}
          node={nodeDialog?.node}
          modules={nodeModuleOptions}
          loading={saveLoading}
          canEdit={canEdit}
          onSave={(draft) => void saveNode(draft)}
          onClose={() => setNodeDialog(null)}
        />
      </>
    );
  }

  return (
    <>
      <section className="debug-admin-split-panel" aria-label="参数重载绑定">
        <p className="debug-admin-note">参数重载绑定将参数管理库定义映射到设备节点；参数元数据来自 M1，此处仅维护路径与协议。</p>
        {panelActions}
        {error ? <p className="debug-admin-error">{error}</p> : null}
        <table className="debug-admin-table">
          <thead>
            <tr>
              <th>参数</th>
              <th>模块</th>
              <th>协议</th>
              <th>节点路径</th>
              <th>访问</th>
              <th>状态</th>
              {canEdit ? <th>操作</th> : null}
            </tr>
          </thead>
          <tbody>
            {bindings.map((binding) => (
              <tr key={binding.id}>
                <td>{binding.parameterName ?? binding.parameterDefinitionId}</td>
                <td>{binding.module ?? "—"}</td>
                <td>{binding.protocol.toUpperCase()}</td>
                <td>{binding.nodePath}</td>
                <td>{binding.accessMode}</td>
                <td>{binding.enabled ? "启用" : "禁用"}</td>
                {canEdit ? (
                  <td>
                    <button type="button" className="button subtle param-admin-row-action" onClick={() => setBindingDialog({ mode: "edit", binding })}>
                      编辑
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {bindings.length === 0 ? <p className="debug-admin-note">暂无重载绑定。</p> : null}
      </section>

      <ReloadBindingEditorDialog
        open={Boolean(bindingDialog)}
        mode={bindingDialog?.mode ?? "create"}
        binding={bindingDialog?.binding}
        projectId={projectId}
        candidates={reloadCandidates}
        candidatesLoading={candidatesLoading}
        loading={saveLoading}
        canEdit={canEdit}
        onSave={(draft) => void saveBinding(draft)}
        onClose={() => setBindingDialog(null)}
      />
    </>
  );
}
