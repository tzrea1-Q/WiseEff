import { useEffect, useId, useState } from "react";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import type { DebugModuleDeletionInput, DebugModuleDeletionPreview } from "@/infrastructure/http/debuggingAdminClient";
import { presentError } from "@/infrastructure/http/presentError";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";

export function DebugModuleDeletionDialog({ module, modules, onPreview, onDelete, onCancel, onMoveChild, onEditNode }: {
  module: FlatModuleNode;
  modules: readonly FlatModuleNode[];
  onPreview: (moduleId: string, targetModuleId: string | null) => Promise<DebugModuleDeletionPreview>;
  onDelete: (moduleId: string, input: DebugModuleDeletionInput) => void | Promise<void>;
  onCancel: () => void;
  onMoveChild: (moduleId: string) => void;
  onEditNode: (nodeId: string) => void;
}) {
  const [targetId, setTargetId] = useState("");
  const [preview, setPreview] = useState<DebugModuleDeletionPreview | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Derived, not set from the effect: React defers effect updates, and confirmation must
  // stop in the same render that changes the target, before a stale preview can be confirmed.
  const previewKey = JSON.stringify([module.id, targetId, attempt]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== previewKey;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [mutationId] = useState(() => crypto.randomUUID());
  const targetLabelId = useId();
  useEffect(() => {
    let cancelled = false;
    setPreview(null); setError("");
    onPreview(module.id, targetId || null).then(value => { if (!cancelled) setPreview(value); })
      .catch(failure => { if (!cancelled) setError(presentError(failure, "读取删除影响失败，请重试。")); })
      .finally(() => { if (!cancelled) setLoadedKey(previewKey); });
    return () => { cancelled = true; };
  }, [module.id, targetId, attempt, onPreview, previewKey]);
  const confirm = async () => {
    if (!preview?.canDelete || pending) return;
    setPending(true); setError("");
    try {
      await onDelete(module.id, { targetModuleId: targetId || null, previewDigest: preview.previewDigest, clientMutationId: mutationId });
      onCancel();
    } catch (failure) {
      setPreview(null); setError(presentError(failure, "删除失败，迁移目标已保留，请重新预览后重试。"));
    } finally { setPending(false); }
  };
  return <ConfirmDialog open title={`删除调试模块「${module.name}」`} tone="danger" confirmLabel="迁移节点并删除模块"
    pending={pending} confirmDisabled={loading || !preview?.canDelete} error={error} onCancel={onCancel} onConfirm={() => { void confirm(); }}
    description={<><p>仅删除此叶子分类；节点 ID、定义、设备关联和调试历史全部保留。</p>
      {loading ? <p role="status">正在核对节点和模块…</p> : preview ? <p>将迁移 {preview.nodeCount} 个节点，其中 {preview.legacyNodeCount} 个使用旧名称归属。</p> : null}</>}
    extra={<>
      <div className="field"><span id={targetLabelId}>节点迁移目标</span>
        <ModuleTreeSelect mode="single" label="节点迁移目标" labelledBy={targetLabelId} nodes={modules}
          selectableIds={new Set(modules.filter(item => item.id !== module.id).map(item => item.id))}
          value={targetId} onChange={value => setTargetId(typeof value === "string" ? value : "")} disabled={pending}
          placeholder="未分类" includeRootOption rootOptionLabel="未分类" portalMenu />
      </div>
      {preview?.children.length ? <div><p>仍有子模块，请先调整以下子模块：</p><ul>{preview.children.map(child =>
        <li key={child.id}><button type="button" className="button subtle" onClick={() => onMoveChild(child.id)}>移动「{child.name}」</button></li>)}</ul></div> : null}
      {preview?.ambiguousNodes.length ? <div><p>同名模块使旧名称归属不明确，请先为这些节点指定模块：</p><ul>{preview.ambiguousNodes.map(node =>
        <li key={node.id}><button type="button" className="button subtle" onClick={() => onEditNode(node.id)}>编辑「{node.name}」</button></li>)}</ul></div> : null}
      {error ? <button type="button" className="button subtle" disabled={pending || loading} onClick={() => setAttempt(value => value + 1)}>重新预览</button> : null}
    </>} />;
}
