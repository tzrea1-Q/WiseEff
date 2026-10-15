import { CircleX, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SearchField } from "@/components/common/SearchField";
import { useDirtyState } from "@/components/layout/SettingsFormPage";
import { DebugAdminSelectControl } from "@/components/admin/DebugAdminSelectControl";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import { debugNodeModuleId } from "@/debugAdminModules";
import { bindingForProtocol } from "@/debugAdminDraft";
import { getBindingNodePathValidationError, normalizeBindingNodePath } from "@/domain/debugging/bindingNodePath";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import type { DebugConnectionProtocol, DebugNodeProtocolBinding, DebugNodeRegistryEntry } from "@/domain/debugging/types";
import type { ParameterRepository, ProjectSummary } from "@/application/ports/ParameterRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CatalogProtectedProjectBindingListResponse } from "@/infrastructure/http/parameterCatalogDtos";
import "./debug-node-editor.css";

export type DebugNodeDraft = {
  name: string;
  description: string;
  detailedDescription: string;
  writeFormatExample: string;
  writeFormatHint: string;
  module: string;
  moduleId?: string;
  enabled: boolean;
  canonicalBinding?: DebugNodeRegistryEntry["canonicalBinding"];
  bindings?: DebugNodeProtocolBinding[];
  archiveProtocols?: DebugConnectionProtocol[];
};

const BINDING_PROTOCOLS: DebugConnectionProtocol[] = ["hdc", "adb"];

function editableBindings(bindings: DebugNodeProtocolBinding[] = []): DebugNodeProtocolBinding[] {
  return BINDING_PROTOCOLS.map((protocol) => {
    const binding = bindingForProtocol(bindings, protocol);
    return { ...binding, notes: binding.notes ?? "" };
  });
}

function sameBinding(left: DebugNodeProtocolBinding, right: DebugNodeProtocolBinding) {
  return normalizeBindingNodePath(left.nodePath) === normalizeBindingNodePath(right.nodePath) &&
    left.accessMode === right.accessMode && left.enabled === right.enabled && (left.notes ?? "") === (right.notes ?? "");
}

export type DebugNodeEditorDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  node?: DebugNodeRegistryEntry | null;
  moduleNodes: readonly FlatModuleNode[];
  loading: boolean;
  canEdit: boolean;
  error?: string;
  parameterRepository?: Pick<ParameterRepository, "listProjects">;
  parameterCatalogRepository?: Pick<ParameterCatalogRepository, "listProtectedProjectBindings">;
  onSave: (draft: DebugNodeDraft) => void;
  onClose: () => void;
};

function emptyDraft(moduleNodes: readonly FlatModuleNode[]): DebugNodeDraft {
  const defaultNode = moduleNodes[0];
  return {
    name: "",
    description: "",
    detailedDescription: "",
    writeFormatExample: "",
    writeFormatHint: "",
    module: defaultNode?.name ?? "",
    moduleId: defaultNode?.id,
    enabled: true,
    bindings: editableBindings(),
    archiveProtocols: []
  };
}

function draftFromNode(node: DebugNodeRegistryEntry, moduleNodes: readonly FlatModuleNode[]): DebugNodeDraft {
  return {
    name: node.name,
    description: node.description,
    detailedDescription: node.detailedDescription,
    writeFormatExample: node.writeFormatExample,
    writeFormatHint: node.writeFormatHint,
    module: node.module,
    moduleId: debugNodeModuleId(node, moduleNodes),
    enabled: node.enabled,
    canonicalBinding: node.canonicalBinding,
    bindings: editableBindings(node.bindings),
    archiveProtocols: []
  };
}

export function DebugNodeEditorDialog({
  open,
  mode,
  node,
  moduleNodes,
  loading,
  canEdit,
  error,
  parameterRepository,
  parameterCatalogRepository,
  onSave,
  onClose
}: DebugNodeEditorDialogProps) {
  const [draft, setDraft] = useState<DebugNodeDraft>(() => emptyDraft(moduleNodes));
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState("");
  const [parameters, setParameters] = useState<CatalogProtectedProjectBindingListResponse["items"]>([]);
  const [associationLoading, setAssociationLoading] = useState(false);
  const [associationError, setAssociationError] = useState("");
  const [parameterSearch, setParameterSearch] = useState("");
  const [initialDraft, setInitialDraft] = useState(draft);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [archiveProtocol, setArchiveProtocol] = useState<DebugConnectionProtocol | null>(null);
  const [expandedProtocols, setExpandedProtocols] = useState<Partial<Record<DebugConnectionProtocol, boolean>>>({});
  const [associationOpen, setAssociationOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [invalidField, setInvalidField] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const session = useRef("");

  useEffect(() => {
    if (!open) {
      session.current = "";
      return;
    }
    const sessionKey = `${mode}:${node?.id ?? "new"}`;
    if (session.current !== sessionKey) {
      session.current = sessionKey;
      const nextDraft = mode === "edit" && node ? draftFromNode(node, moduleNodes) : emptyDraft(moduleNodes);
      setDraft(nextDraft);
      setInitialDraft(nextDraft);
      setProjectId(mode === "edit" ? node?.canonicalBinding?.projectId ?? "" : "");
      setParameterSearch("");
      setDiscardOpen(false);
      setArchiveProtocol(null);
      setExpandedProtocols({});
      setAssociationOpen(false);
      setSubmitted(false);
      setTouched({});
    }
  }, [mode, moduleNodes, node, open]);

  useEffect(() => {
    if (!invalidField) return;
    const field = bodyRef.current?.querySelector<HTMLElement>(`[data-editor-field="${invalidField}"]`);
    const control = field?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? field?.querySelector<HTMLElement>("input, button");
    control?.focus();
    control?.scrollIntoView?.({ block: "nearest" });
    setInvalidField("");
  }, [invalidField]);

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
      errorRef.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [error]);

  useEffect(() => {
    if (!open || !parameterRepository) return;
    let cancelled = false;
    setAssociationLoading(true);
    setAssociationError("");
    setProjects([]);
    setParameters([]);
    Promise.all([
      parameterRepository.listProjects(),
      projectId ? parameterCatalogRepository?.listProtectedProjectBindings?.(projectId) ?? Promise.reject(new Error("Canonical binding reader unavailable")) : Promise.resolve({ items: [] })
    ]).then(([loadedProjects, loadedParameters]) => {
      if (cancelled) return;
      setProjects(loadedProjects);
      setParameters(loadedParameters.items.filter((item) => item.projectId === projectId && item.id && item.effectiveRevisionId && item.currentValueId));
    }).catch(() => {
      if (!cancelled) setAssociationError("无法加载可关联的项目参数，请重新选择项目重试。");
    }).finally(() => {
      if (!cancelled) setAssociationLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, parameterRepository, parameterCatalogRepository, projectId]);

  const fieldsDisabled = !canEdit || loading;
  const selectedModuleId = draft.moduleId ?? "";
  const nameError = !draft.name.trim() ? "请填写节点名称。" : "";
  const moduleError = !moduleNodes.some((item) => item.id === selectedModuleId) ? "请选择有效模块后保存。" : "";
  const associationValidationError = projectId && draft.canonicalBinding?.projectId !== projectId ? "请选择关联参数，或取消项目关联。" : "";
  const archives = draft.archiveProtocols ?? [];
  const pathErrors = Object.fromEntries(BINDING_PROTOCOLS.map((protocol) => {
    const binding = bindingForProtocol(draft.bindings, protocol);
    const saved = bindingForProtocol(initialDraft.bindings, protocol);
    const needsPath = binding.nodePath.length > 0 || binding.enabled || Boolean(binding.notes?.length) || Boolean(saved.nodePath) || binding.accessMode !== saved.accessMode;
    return [protocol, !archives.includes(protocol) && needsPath ? getBindingNodePathValidationError(binding.nodePath) : null];
  })) as Record<DebugConnectionProtocol, string | null>;
  const missingRequirements = nameError || moduleError || pathErrors.hdc || pathErrors.adb || associationValidationError;
  const initialProjectId = initialDraft.canonicalBinding?.projectId ?? "";
  const dirty = useDirtyState({ draft, projectId }, { draft: initialDraft, projectId: initialProjectId });
  const updateBinding = (protocol: DebugConnectionProtocol, patch: Partial<DebugNodeProtocolBinding>) => {
    setDraft((current) => ({ ...current, bindings: (current.bindings ?? editableBindings()).map((binding) => binding.protocol === protocol ? { ...binding, ...patch } : binding) }));
  };
  const saveDraft = () => {
    if (fieldsDisabled) return;
    setSubmitted(true);
    const firstInvalid = nameError ? "name" : moduleError ? "module" : pathErrors.hdc ? "hdc" : pathErrors.adb ? "adb" : associationValidationError ? "association" : "";
    if (firstInvalid) {
      if (firstInvalid === "association") setAssociationOpen(true);
      setInvalidField(firstInvalid);
      return;
    }
    onSave({ ...draft, bindings: (draft.bindings ?? []).filter((binding) => !archives.includes(binding.protocol) && binding.nodePath.trim() &&
      (mode === "create" || !sameBinding(binding, bindingForProtocol(initialDraft.bindings, binding.protocol))))
      .map((binding) => ({ ...binding, nodePath: normalizeBindingNodePath(binding.nodePath) })), archiveProtocols: archives });
  };
  const requestClose = () => {
    if (loading) return;
    if (dirty) setDiscardOpen(true);
    else onClose();
  };
  const search = parameterSearch.trim().toLocaleLowerCase();
  const matchesSearch = (item: (typeof parameters)[number]) =>
    `${item.displayName ?? ""} ${item.propertyKey} ${item.locator ?? ""} ${item.driverModule}`.toLocaleLowerCase().includes(search);
  const matchingParameters = parameters.filter(matchesSearch);
  const filteredParameters = parameters.filter((item) => item.id === draft.canonicalBinding?.bindingId || matchesSearch(item));
  const configuredBindings = (draft.bindings ?? []).filter((binding) => binding.nodePath.trim() && !archives.includes(binding.protocol));
  const readOnlyNode = configuredBindings.length > 0 && configuredBindings.every((binding) => binding.accessMode === "RO");
  const associatedParameter = parameters.find((item) => item.id === draft.canonicalBinding?.bindingId);
  const associationSummary = projectId ? draft.canonicalBinding?.projectId === projectId ?
    `${projects.find((project) => project.id === projectId)?.name ?? "当前关联项目"} · ${associatedParameter?.displayName ?? associatedParameter?.propertyKey ?? "当前关联参数"}` : "待选择参数" : "未关联";

  return (
    <><ModalDialog
      open={open}
      onDismiss={loading ? undefined : requestClose}
      className="submission-dialog param-admin-editor-dialog debug-admin-definition-dialog debug-node-editor"
    >
      {({ titleId }) => (
        <>
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">节点注册表</span>
            <h2 id={titleId}>{mode === "create" ? "创建节点" : "编辑节点"}</h2>
            <p>节点信息与协议配置统一保存。</p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={requestClose} disabled={loading} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-editor-dialog-body" ref={bodyRef}>
          {error ? <p className="field-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p> : null}
          <section className="debug-node-editor-section" aria-labelledby="debug-node-basic-title">
            <header><h3 id="debug-node-basic-title">基本信息</h3></header>
            <div className="debug-node-editor-fields debug-node-editor-basics">
            <label className="debug-admin-field" data-editor-field="name">
              <span className="debug-admin-field-label">名称 <small aria-hidden="true">必填</small></span>
              <Input aria-label="名称" required aria-invalid={Boolean(nameError && (submitted || touched.name))} aria-describedby={nameError && (submitted || touched.name) ? "debug-node-name-error" : undefined} value={draft.name} disabled={fieldsDisabled} onBlur={() => setTouched((current) => ({ ...current, name: true }))} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              {nameError && (submitted || touched.name) ? <span id="debug-node-name-error" className="field-error" role="alert">{nameError}</span> : null}
            </label>
            <div className="debug-admin-field" data-editor-field="module">
              <span className="debug-admin-field-label" id="debug-node-module-label">
                模块 <small aria-hidden="true">必填</small>
              </span>
              <ModuleTreeSelect
                label="选择模块"
                labelledBy="debug-node-module-label"
                mode="single"
                nodes={moduleNodes}
                value={selectedModuleId}
                disabled={fieldsDisabled || moduleNodes.length === 0}
                placeholder={moduleNodes.length === 0 ? "请先在模块管理中创建模块" : "请选择模块"}
                onChange={(moduleId) => {
                  const next = typeof moduleId === "string" ? moduleId : moduleId[0];
                  const treeNode = moduleNodes.find((item) => item.id === next);
                  if (treeNode) {
                    setDraft((current) => ({ ...current, moduleId: treeNode.id, module: treeNode.name }));
                  }
                }}
              />
              {moduleError && submitted ? <span className="field-error" role="alert">{moduleError}</span> : null}
            </div>
            <label className="debug-node-editor-toggle debug-node-editor-node-toggle">
              <span className="debug-admin-field-label">节点状态</span>
              <span><input aria-label="启用节点" type="checkbox" checked={draft.enabled} disabled={fieldsDisabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} />启用</span>
            </label>
            <label className="debug-admin-field debug-node-editor-full">
              <span className="debug-admin-field-label">简述 <small aria-hidden="true">可选</small></span>
              <Input aria-label="简述" value={draft.description} disabled={fieldsDisabled} placeholder="用于目录列表展示的简短说明" onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
            </label>
            </div>
          </section>
          <section className="debug-node-editor-section" aria-labelledby="debug-node-protocol-title">
            <header className="debug-node-editor-protocol-head"><h3 id="debug-node-protocol-title">协议路径</h3><small>未配置的协议可留空；停用会保留路径与备注。</small></header>
            <div className="debug-node-editor-protocols">
              {BINDING_PROTOCOLS.map((protocol) => {
                const binding = bindingForProtocol(draft.bindings, protocol);
                const saved = bindingForProtocol(initialDraft.bindings, protocol);
                const label = protocol.toUpperCase();
                const archived = archives.includes(protocol);
                const pathError = pathErrors[protocol];
                const showError = Boolean(pathError && (submitted || touched[protocol]));
                const pathId = `debug-node-${protocol}-path`;
                const notesId = `debug-node-${protocol}-notes`;
                const status = archived ? "待归档" : showError ? "路径待修正" : !binding.nodePath.trim() ? "未配置" : binding.enabled ? "已启用" : "已停用";
                return <section key={protocol} className="debug-node-editor-protocol" aria-label={`${label} 协议配置`}>
                  <div className="debug-node-editor-protocol-row">
                    <div className="debug-node-editor-protocol-name"><h4>{label}</h4><small>{status}</small></div>
                    <div className="debug-admin-field" data-editor-field={protocol}>
                      <label htmlFor={pathId} className="sr-only">{label} 节点路径</label>
                      <Input id={pathId} aria-label={`${label} 节点路径`} aria-invalid={showError} aria-describedby={showError ? `${pathId}-error` : undefined} value={binding.nodePath} disabled={fieldsDisabled || archived} placeholder="设备绝对路径，可留空" onBlur={() => setTouched((current) => ({ ...current, [protocol]: true }))} onChange={(event) => updateBinding(protocol, { nodePath: event.target.value })} />
                      {showError ? <span id={`${pathId}-error`} className="field-error" role="alert">{pathError}</span> : null}
                    </div>
                    <DebugAdminSelectControl ariaLabel={`${label} 访问模式`} className="debug-node-editor-access" withinModal value={binding.accessMode} disabled={fieldsDisabled || archived} onValueChange={(value) => updateBinding(protocol, { accessMode: value })} options={[
                      { value: "RO", label: "RO · 只读" },
                      { value: "WO", label: "WO · 只写" },
                      { value: "RW", label: "RW · 读写" }
                    ]} />
                    <label className="debug-node-editor-toggle"><input aria-label={`启用 ${label} 协议`} type="checkbox" checked={archived ? false : binding.enabled} disabled={fieldsDisabled || archived} onChange={(event) => updateBinding(protocol, { enabled: event.target.checked })} /><span>启用</span></label>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`${label} 更多配置`} aria-expanded={Boolean(expandedProtocols[protocol])} aria-controls={`debug-node-${protocol}-more`} disabled={fieldsDisabled} onClick={() => setExpandedProtocols((current) => ({ ...current, [protocol]: !current[protocol] }))}><MoreHorizontal size={16} aria-hidden="true" /></Button>
                  </div>
                  <div className="debug-node-editor-protocol-more" id={`debug-node-${protocol}-more`} hidden={!expandedProtocols[protocol]}>
                    <label className="debug-admin-field" htmlFor={notesId}><span className="debug-admin-field-label">{label} 备注 <small>可选</small></span><Input id={notesId} aria-label={`${label} 备注`} value={binding.notes ?? ""} disabled={fieldsDisabled || archived} onChange={(event) => updateBinding(protocol, { notes: event.target.value })} /></label>
                    {saved.nodePath.trim() ? <div className="debug-node-editor-archive-action">{archived ? <><small>保存后归档；当前尚未执行。</small><Button type="button" variant="outline" size="sm" disabled={fieldsDisabled} onClick={() => setDraft((current) => ({ ...current, archiveProtocols: (current.archiveProtocols ?? []).filter((item) => item !== protocol) }))}>撤销 {label} 归档</Button></> : <><small>归档将在本次统一保存时执行。</small><Button type="button" variant="outline" size="sm" disabled={fieldsDisabled} onClick={() => setArchiveProtocol(protocol)}>归档 {label} 绑定</Button></>}</div> : <small>该协议尚未配置，无需归档。</small>}
                  </div>
                </section>;
              })}
            </div>
          </section>
          <details className="debug-node-editor-section debug-node-editor-fold">
            <summary><span>详细描述</span><small>{draft.detailedDescription.trim() ? "已填写" : "未填写"}</small></summary>
            <label className="debug-admin-field"><span className="sr-only">详细描述</span><Textarea aria-label="详细描述" value={draft.detailedDescription} disabled={fieldsDisabled} placeholder="补充节点用途、读写约束与注意事项" rows={3} onChange={(event) => setDraft((current) => ({ ...current, detailedDescription: event.target.value }))} /></label>
          </details>
            {parameterRepository ? (
              <details className="debug-node-editor-section debug-node-editor-fold" open={associationOpen}>
                <summary onClick={(event) => { event.preventDefault(); setAssociationOpen((current) => !current); }}><span>项目参数关联</span><small>{associationSummary}{associationError && draft.canonicalBinding ? " · 读取不可用，关联已保留" : ""}</small></summary>
                <div className="debug-node-editor-fields">
                <div className="debug-admin-field">
                  <label htmlFor="debug-node-associated-project" className="debug-admin-field-label">关联项目</label>
                  <DebugAdminSelectControl id="debug-node-associated-project" ariaLabel="关联项目" ariaDescribedBy="debug-node-association-help" withinModal value={projectId} disabled={fieldsDisabled || associationLoading} onValueChange={(nextProjectId) => {
                    setProjectId(nextProjectId);
                    setParameterSearch("");
                    setParameters([]);
                    setDraft((current) => ({ ...current, canonicalBinding: null }));
                  }} options={[
                    { value: "", label: "不关联项目参数" },
                    ...(projectId && !projects.some((project) => project.id === projectId) ? [{ value: projectId, label: "当前关联项目" }] : []),
                    ...projects.map((project) => ({ value: project.id, label: project.name }))
                  ]} />
                </div>
                {projectId ? (
                  <div className="debug-admin-field" data-editor-field="association">
                    <label htmlFor="debug-node-associated-parameter" className="debug-admin-field-label">关联参数</label>
                    <SearchField value={parameterSearch} onValueChange={setParameterSearch} ariaLabel="搜索关联参数" placeholder="搜索名称、模块或路径" disabled={fieldsDisabled || associationLoading} />
                    <DebugAdminSelectControl id="debug-node-associated-parameter" ariaLabel="关联参数" ariaDescribedBy={submitted && associationValidationError ? "debug-node-association-error" : "debug-node-association-help"} ariaInvalid={Boolean(submitted && associationValidationError)} ariaRequired withinModal value={draft.canonicalBinding?.bindingId ?? ""} disabled={fieldsDisabled || associationLoading} onValueChange={(bindingId) => {
                      const selected = parameters.find((item) => item.id === bindingId);
                      setDraft((current) => ({ ...current, canonicalBinding: selected ? {
                        projectId: selected.projectId!,
                        bindingId: selected.id,
                        expectedEffectiveRevisionId: selected.effectiveRevisionId!,
                        expectedCurrentValueId: selected.currentValueId!
                      } : null }));
                    }} options={[
                      { value: "", label: "请选择项目参数" },
                      ...(draft.canonicalBinding && !parameters.some((item) => item.id === draft.canonicalBinding?.bindingId) ? [{ value: draft.canonicalBinding.bindingId, label: "当前关联参数" }] : []),
                      ...filteredParameters.map((item) => ({ value: item.id, label: `${item.displayName ?? item.propertyKey} · ${item.locator || item.driverModule}` }))
                    ]} />
                    {submitted && associationValidationError ? <span className="field-error" role="alert" id="debug-node-association-error">{associationValidationError}</span> : null}
                    {search ? <small role="status">{matchingParameters.length ? `匹配参数 ${matchingParameters.length} 项` : "没有匹配的参数，请调整搜索内容。当前选择仍保留。"}</small> : null}
                  </div>
                ) : null}
                </div>
                <p id="debug-node-association-help" className="debug-node-editor-help" role={associationError ? "alert" : undefined}>
                  {associationLoading ? "正在加载项目参数…" : associationError || (projectId && parameters.length === 0 ? "该项目暂无可关联参数；可保留当前关联，或选择不关联项目参数。" : "可选：关联项目参数后按其当前版本校验；独立节点可不关联。")}
                </p>
              </details>
            ) : null}
          <details className="debug-node-editor-section debug-node-editor-fold debug-node-editor-write">
            <summary><span>写入格式</span><small>{draft.writeFormatExample.trim() || draft.writeFormatHint.trim() ? "已填写" : readOnlyNode ? "只读协议，无需填写" : "未填写"}</small></summary>
            <p className="debug-node-editor-help">{readOnlyNode ? "当前协议均为只读，无需填写。已有格式信息会保留；调整为可写时可继续使用。" : "仅用于可写协议的输入提示；不会改变节点的访问权限。"}</p>
            <div className="debug-node-editor-fields">
            <label className="debug-admin-field">
              <span className="debug-admin-field-label">写入格式示例</span>
              <Input
                aria-label="写入格式示例"
                value={draft.writeFormatExample}
                disabled={fieldsDisabled}
                placeholder="例如 3100"
                onChange={(event) => setDraft((current) => ({ ...current, writeFormatExample: event.target.value }))}
              />
            </label>
            <label className="debug-admin-field">
              <span className="debug-admin-field-label">写入格式说明</span>
              <Textarea
                aria-label="写入格式说明"
                value={draft.writeFormatHint}
                disabled={fieldsDisabled}
                placeholder="留空时使用默认说明：例如输入示例值，系统会通过 HDC/ADB 写入当前节点"
                rows={2}
                onChange={(event) => setDraft((current) => ({ ...current, writeFormatHint: event.target.value }))}
              />
            </label>
          </div>
          </details>
        </div>

        <div className="dialog-actions">
          <span className="debug-node-editor-save-help" id="debug-node-save-help" role="status">{!canEdit ? "当前账号没有编辑权限。" : submitted && missingRequirements ? "请检查标记的字段。" : missingRequirements || (dirty ? "有未保存的更改" : "")}</span>
          <button className="button subtle" type="button" onClick={requestClose} disabled={loading}>
            取消
          </button>
          <button className="button primary" aria-describedby="debug-node-save-help" disabled={fieldsDisabled} type="button" onClick={saveDraft}>
            {loading ? "保存中…" : "保存"}
          </button>
        </div>
        </>
      )}
    </ModalDialog>
    <ConfirmDialog open={open && discardOpen} pending={loading} title="放弃未保存的更改？" description="关闭将放弃当前节点信息、协议配置及待归档操作。" confirmLabel="放弃并关闭" cancelLabel="继续编辑" tone="danger" onConfirm={() => { if (!loading) { setDiscardOpen(false); onClose(); } }} onCancel={() => setDiscardOpen(false)} />
    <ConfirmDialog open={open && archiveProtocol !== null} pending={loading} title={`归档 ${archiveProtocol?.toUpperCase() ?? ""} 绑定？`} description="确认后将放弃此协议尚未保存的修改，恢复其已保存配置并标记为待归档；其他协议的草稿保留。归档在点击「保存」时执行，保存前可以撤销。" confirmLabel="标记待归档" tone="danger" onConfirm={() => {
      if (!archiveProtocol || fieldsDisabled) return;
      const protocol = archiveProtocol;
      setDraft((current) => ({ ...current, bindings: (current.bindings ?? []).map((binding) => binding.protocol === protocol ? { ...bindingForProtocol(initialDraft.bindings, protocol) } : binding), archiveProtocols: [...(current.archiveProtocols ?? []), protocol] }));
      setArchiveProtocol(null);
    }} onCancel={() => setArchiveProtocol(null)} />
    </>
  );
}
