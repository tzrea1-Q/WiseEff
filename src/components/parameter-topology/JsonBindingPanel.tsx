import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, CircleX, Download, Eye, History, Pencil } from "lucide-react";
import type {
  ProjectParameterBinding,
  TopologyDiagnostic
} from "@/domain/parameter-topology/types";
import type { ParameterModuleRegistry } from "@/domain/parameter-topology/moduleRegistry";
import { SearchField } from "@/components/common/SearchField";
import { Textarea } from "@/components/ui/textarea";
import { ModalDialog } from "@/components/common/ModalDialog";
import { presentError } from "@/infrastructure/http/presentError";
import { formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import { buildModuleTree } from "@/application/parameters/buildModuleTree";
import { DtsTopologyNavigator } from "./DtsTopologyNavigator";
import type { DtsWorkbenchTreeNode } from "@/application/parameters/buildDtsTopologyTree";

export type BindingEditValidation = {
  valid: boolean;
  diagnostics: TopologyDiagnostic[];
};

export type BindingEditInput = {
  bindingId: string;
  rawValue: string;
  reason: string;
  action?: "set" | "delete";
};

export type JsonBindingHistoryEntry = {
  id: string;
  reason: string;
  createdAt: string;
  oldCurrentValueId: string | null;
  newCurrentValueId: string | null;
  valueState?: "present" | "deleted" | null;
};

export type JsonBindingPanelProps = {
  bindings: readonly ProjectParameterBinding[];
  moduleRegistry?: ParameterModuleRegistry | null;
  canEdit?: boolean;
  draftBindingIds?: ReadonlySet<string>;
  currentEdits?: React.ReactNode;
  onValidateEdit?: (input: BindingEditInput) =>
    | BindingEditValidation
    | Promise<BindingEditValidation>;
  onExportBinding?: (bindingId: string) => Promise<void>;
  onLoadHistory?: (bindingId: string) => Promise<readonly JsonBindingHistoryEntry[]>;
};

function selectedSubtreeBindingIds(
  roots: DtsWorkbenchTreeNode[],
  selectedNodeId: string | null
): Set<string> | null {
  if (!selectedNodeId) return null;
  const pending = [...roots];
  let selected: DtsWorkbenchTreeNode | undefined;
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.id === selectedNodeId) {
      selected = node;
      break;
    }
    pending.push(...node.children);
  }
  if (!selected) return null;

  const bindingIds = new Set<string>();
  const subtree = [selected];
  while (subtree.length > 0) {
    const node = subtree.pop()!;
    for (const bindingId of node.bindingIds) bindingIds.add(bindingId);
    subtree.push(...node.children);
  }
  return bindingIds;
}

function treeContainsNode(nodes: DtsWorkbenchTreeNode[], nodeId: string): boolean {
  for (const node of nodes) {
    if (node.id === nodeId) return true;
    if (treeContainsNode(node.children, nodeId)) return true;
  }
  return false;
}

/** JSON bindings workbench matching DTS layout (Topology Navigator + Table + Modal Dialogs). */
export function JsonBindingPanel({
  bindings,
  moduleRegistry,
  canEdit = false,
  draftBindingIds,
  currentEdits,
  onValidateEdit,
  onExportBinding,
  onLoadHistory
}: JsonBindingPanelProps) {
  const jsonBindings = useMemo(
    () => bindings.filter((binding) => binding.effectiveValue.kind === "json"),
    [bindings]
  );
  const [query, setQuery] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Dialog states
  const [viewingBindingId, setViewingBindingId] = useState<string | null>(null);
  const [editingBindingId, setEditingBindingId] = useState<string | null>(null);

  // Draft form states inside edit dialog
  const activeEditBinding = useMemo(
    () => (editingBindingId ? jsonBindings.find((b) => b.id === editingBindingId) ?? null : null),
    [editingBindingId, jsonBindings]
  );
  const activeViewBinding = useMemo(
    () => (viewingBindingId ? jsonBindings.find((b) => b.id === viewingBindingId) ?? null : null),
    [viewingBindingId, jsonBindings]
  );

  const [draftRaw, setDraftRaw] = useState("");
  const [draftReason, setDraftReason] = useState("");
  const [diagnostics, setDiagnostics] = useState<TopologyDiagnostic[]>([]);
  const [validating, setValidating] = useState(false);
  const diagnosticId = useId();
  const targetInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Export & History states
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly JsonBindingHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Focus restore ref
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (activeEditBinding) {
      setDraftRaw(activeEditBinding.rawValue);
      setDraftReason("");
      setDiagnostics([]);
      setHistory([]);
      setHistoryError(null);
    }
  }, [activeEditBinding]);

  useEffect(() => {
    if (activeViewBinding) {
      setHistory([]);
      setHistoryError(null);
    }
  }, [activeViewBinding]);

  // Build module navigation tree
  const jsonRows = useMemo(() => {
    return jsonBindings.map((b) => {
      const mod = moduleRegistry?.modules.find((m) => m.id === b.moduleId);
      const moduleName = mod?.name ?? b.moduleId ?? b.driverModule ?? "固定配置";
      const moduleSortOrder = mod?.sortOrder ?? 100;
      return {
        bindingId: b.id,
        moduleId: b.moduleId ?? b.driverModule ?? "json-general",
        moduleName,
        moduleSortOrder,
        driverModule: b.driverModule,
        compatible: null,
        instanceName: b.instanceName,
        topologyPath: b.locator,
        governanceState: "valid" as const
      };
    });
  }, [jsonBindings, moduleRegistry]);

  const tree = useMemo(() => {
    return buildModuleTree({
      rows: jsonRows,
      modules: moduleRegistry?.modules,
      groupByDevice: true
    });
  }, [jsonRows, moduleRegistry]);

  const selectedNodeExists = selectedNodeId ? treeContainsNode(tree, selectedNodeId) : true;
  const effectiveSelectedNodeId = selectedNodeExists ? selectedNodeId : null;

  useEffect(() => {
    if (selectedNodeId && !selectedNodeExists) setSelectedNodeId(null);
  }, [selectedNodeExists, selectedNodeId]);

  const subtreeBindingIds = useMemo(
    () => selectedSubtreeBindingIds(tree, effectiveSelectedNodeId),
    [effectiveSelectedNodeId, tree]
  );

  const filteredBindings = useMemo(() => {
    let result = jsonBindings;
    if (subtreeBindingIds) {
      result = result.filter((b) => subtreeBindingIds.has(b.id));
    }
    const q = query.trim().toLowerCase();
    if (!q) return result;
    return result.filter((binding) => {
      const prop = binding.propertyKey.toLowerCase();
      const mod = `${binding.moduleId ?? ""} ${binding.driverModule ?? ""}`.toLowerCase();
      const inst = (binding.instanceName ?? "").toLowerCase();
      const loc = (binding.locator ?? "").toLowerCase();
      const val = (binding.rawValue ?? "").toLowerCase();
      return (
        prop.includes(q) ||
        mod.includes(q) ||
        inst.includes(q) ||
        loc.includes(q) ||
        val.includes(q)
      );
    });
  }, [jsonBindings, query, subtreeBindingIds]);

  const syntaxStatus = useMemo(() => {
    if (!draftRaw.trim()) return null;
    try {
      JSON.parse(draftRaw);
      return { valid: true, message: "JSON 格式有效" };
    } catch {
      return { valid: false, message: "JSON 语法解析异常，请检查标点及闭合" };
    }
  }, [draftRaw]);

  const submitDraft = (action: "set" | "delete") => {
    if (!activeEditBinding) return;
    setValidating(true);
    void Promise.resolve(
      onValidateEdit?.({
        bindingId: activeEditBinding.id,
        rawValue: action === "delete" ? "" : draftRaw,
        reason: draftReason.trim(),
        ...(action === "delete" ? { action } : {})
      })
    )
      .then((result) => {
        setDiagnostics(result?.diagnostics ?? []);
        if (result?.valid !== false && (!result?.diagnostics || result.diagnostics.length === 0)) {
          setEditingBindingId(null);
        }
      })
      .finally(() => {
        setValidating(false);
      });
  };

  const loadHistoryFor = (bindingId: string) => {
    if (!onLoadHistory) return;
    setHistoryLoading(true);
    setHistoryError(null);
    void onLoadHistory(bindingId)
      .then(setHistory)
      .catch(() => setHistoryError("固定值历史加载失败，请稍后重试。"))
      .finally(() => setHistoryLoading(false));
  };

  const openDetail = (bindingId: string) => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setViewingBindingId(bindingId);
  };

  const openDraft = (bindingId: string) => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setViewingBindingId(null);
    setEditingBindingId(bindingId);
  };

  const closeDialogs = () => {
    setViewingBindingId(null);
    setEditingBindingId(null);
    queueMicrotask(() => {
      if (openerRef.current?.isConnected) {
        openerRef.current.focus();
      }
    });
  };

  const handleExport = (bindingId: string) => {
    if (!onExportBinding) return;
    setExportingId(bindingId);
    setExportError(null);
    void onExportBinding(bindingId)
      .catch(() => setExportError("固定源导出失败，请稍后重试。"))
      .finally(() => setExportingId(null));
  };

  if (jsonBindings.length === 0) return null;

  return (
    <section className="dts-parameter-workbench json-parameter-workbench" role="region" aria-label="JSON 参数">
      <div className="dts-parameter-workbench__toolbar">
        <div className="dts-parameter-workbench__search">
          <SearchField
            value={query}
            onValueChange={setQuery}
            onClear={() => setQuery("")}
            ariaLabel="搜索 JSON 参数"
            placeholder="搜索参数名、所属模块、器件定位或取值…"
          />
          <span className="dts-parameter-workbench__result-count">
            {query.trim() || effectiveSelectedNodeId
              ? `匹配 ${filteredBindings.length} / ${jsonBindings.length} 项`
              : `共 ${jsonBindings.length} 项`}
          </span>
        </div>
      </div>

      {currentEdits ? (
        <div
          className="dts-parameter-workbench__current-edits dts-draft-tray"
          role="region"
          aria-label="本轮已修改"
        >
          {currentEdits}
        </div>
      ) : null}

      <div className="dts-parameter-workbench__body">
        {/* Module Navigator */}
        <div
          className="dts-parameter-workbench__navigator dts-workbench-topology"
          role="region"
          aria-label="模块导航"
        >
          <div className="dts-parameter-workbench__navigator-header">
            <h3 className="dts-parameter-workbench__navigator-title">
              模块导航
            </h3>
          </div>
          <DtsTopologyNavigator
            view="effective"
            nodes={tree}
            selectedNodeId={effectiveSelectedNodeId}
            defaultExpandDepth={2}
            labelKind="text"
            emptyMessage="暂无模块分组"
            ariaLabel="业务模块树"
            onSelectNode={(nodeId) =>
              setSelectedNodeId((current) => (current === nodeId ? null : nodeId))
            }
          />
        </div>

        {/* Parameter List Table */}
        <div
          className="dts-parameter-workbench__results dts-workbench-list"
          role="region"
          aria-label="JSON 参数列表"
        >
          <div className="dts-workbench-list__scroll-x">
            <div className="dts-workbench-list__scroll-y">
              <table role="table" aria-label="JSON 参数列表" className="json-parameter-workbench-table">
                <thead className="json-parameter-workbench-table__head">
                  <tr>
                    <th scope="col" className="json-parameter-workbench-table__th-property">参数名</th>
                    <th scope="col" className="json-parameter-workbench-table__th-module">所属模块</th>
                    <th scope="col" className="json-parameter-workbench-table__th-locator">器件 / 定位</th>
                    <th scope="col" className="json-parameter-workbench-table__th-value">当前值</th>
                    <th scope="col" className="json-parameter-workbench-table__th-actions">操作</th>
                  </tr>
                </thead>
                <tbody className="json-parameter-workbench-table__body">
                  {filteredBindings.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="json-parameter-workbench__empty">
                        无匹配的 JSON 参数
                      </td>
                    </tr>
                  ) : (
                    filteredBindings.map((binding) => {
                      const isDraft = draftBindingIds?.has(binding.id) ?? false;
                      const isSelected = viewingBindingId === binding.id || editingBindingId === binding.id;
                      const moduleLabel = binding.moduleId ?? binding.driverModule ?? "固定配置";

                      return (
                        <tr
                          key={binding.id}
                          className={`json-parameter-workbench-table__row${isSelected ? " is-selected" : ""}${isDraft ? " is-draft" : ""}`}
                          onClick={() => openDetail(binding.id)}
                        >
                          <td className="dts-parameter-workbench-table__property">
                            <div className="json-parameter-workbench__property-cell">
                              <code>{binding.propertyKey}</code>
                              {isDraft ? (
                                <span className="dts-parameter-workbench-table__draft-badge">草稿</span>
                              ) : null}
                            </div>
                          </td>
                          <td>
                            <span className="dts-parameter-workbench-table__module">
                              <strong>{moduleLabel}</strong>
                            </span>
                          </td>
                          <td className="dts-parameter-workbench-table__identity">
                            <div className="json-parameter-workbench__identity-cell">
                              <strong>{binding.instanceName ?? "—"}</strong>
                              {binding.locator ? <small>{binding.locator}</small> : null}
                            </div>
                          </td>
                          <td>
                            <code className="json-parameter-workbench-table__value-preview" title={binding.rawValue}>
                              {binding.rawValue}
                            </code>
                          </td>
                          <td className="json-parameter-workbench-table__th-actions" onClick={(e) => e.stopPropagation()}>
                            <div className="dts-parameter-workbench-table__actions">
                              <button
                                type="button"
                                className="button subtle dts-parameter-workbench-table__icon-action"
                                title="查看"
                                aria-label={`查看 ${binding.propertyKey}`}
                                onClick={() => openDetail(binding.id)}
                              >
                                <Eye size={15} strokeWidth={1.9} aria-hidden="true" />
                              </button>
                              {canEdit ? (
                                <button
                                  type="button"
                                  className="button subtle dts-parameter-workbench-table__icon-action"
                                  title="编辑"
                                  aria-label={`编辑 ${binding.propertyKey}`}
                                  onClick={() => openDraft(binding.id)}
                                >
                                  <Pencil size={15} strokeWidth={1.9} aria-hidden="true" />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* 1. Detail Dialog (查看弹窗) */}
      {activeViewBinding ? (
        <ModalDialog
          open
          onDismiss={closeDialogs}
          className="dts-binding-detail-dialog"
          backdropClassName="dts-binding-detail-dialog__overlay"
        >
          {({ titleId }) => (
            <div className="dts-binding-detail-dialog__content">
              <div className="dts-binding-detail-dialog__header">
                <h2 id={titleId}>{activeViewBinding.propertyKey} 参数详情</h2>
                <button
                  type="button"
                  className="button ghost"
                  aria-label="关闭参数详情"
                  onClick={closeDialogs}
                >
                  <CircleX size={18} aria-hidden="true" />
                </button>
              </div>

              <section aria-label="属性标识">
                <dl>
                  <div>
                    <dt>参数名</dt>
                    <dd><code>{activeViewBinding.propertyKey}</code></dd>
                  </div>
                  <div>
                    <dt>所属模块</dt>
                    <dd>{activeViewBinding.moduleId ?? activeViewBinding.driverModule ?? "固定配置"}</dd>
                  </div>
                  <div>
                    <dt>器件 / 定位</dt>
                    <dd>{activeViewBinding.instanceName ?? "—"} · <code>{activeViewBinding.locator ?? "—"}</code></dd>
                  </div>
                  <div>
                    <dt>配置状态</dt>
                    <dd>
                      <span className="json-binding-card__status-pill">
                        {activeViewBinding.schemaState === "valid" ? "有效配置" : "待校验"}
                      </span>
                    </dd>
                  </div>
                </dl>
              </section>

              <section aria-label="当前取值">
                <h3>当前值</h3>
                <pre className="json-binding-card__preview-code">
                  {activeViewBinding.rawValue}
                </pre>
              </section>

              {onLoadHistory ? (
                <section aria-label="JSON 参数历史" className="json-binding-card__history">
                  <div className="json-binding-card__history-header">
                    <button
                      type="button"
                      className="button subtle"
                      onClick={() => loadHistoryFor(activeViewBinding.id)}
                      disabled={historyLoading}
                    >
                      <History size={13} aria-hidden="true" />
                      {historyLoading ? "加载历史中…" : "查看固定值历史"}
                    </button>
                    {onExportBinding ? (
                      <button
                        type="button"
                        className="button subtle"
                        disabled={exportingId === activeViewBinding.id}
                        onClick={() => handleExport(activeViewBinding.id)}
                      >
                        <Download size={13} aria-hidden="true" />
                        {exportingId === activeViewBinding.id ? "导出中…" : "导出源文件"}
                      </button>
                    ) : null}
                  </div>
                  {exportError ? <p role="alert" className="json-parameter-workbench__error">{exportError}</p> : null}
                  {historyError ? <p role="alert" className="json-parameter-workbench__error">{historyError}</p> : null}
                  {history.length > 0 ? (
                    <ol className="json-binding-card__history-timeline">
                      {history.map((entry) => (
                        <li key={entry.id} className="json-binding-card__history-entry">
                          <time dateTime={entry.createdAt}>{formatRelativeOrAbsolute(entry.createdAt)}</time> · {entry.valueState === "deleted"
                            ? "删除属性 · " : entry.valueState === "present" ? "更新属性 · " : ""}{entry.reason}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </section>
              ) : null}

              <div className="dts-binding-detail-dialog__footer">
                {canEdit ? (
                  <button
                    type="button"
                    className="button subtle is-primary"
                    onClick={() => openDraft(activeViewBinding.id)}
                  >
                    <Pencil size={13} aria-hidden="true" />
                    编辑此参数
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button subtle"
                  onClick={closeDialogs}
                >
                  关闭
                </button>
              </div>
            </div>
          )}
        </ModalDialog>
      ) : null}

      {/* 2. Draft Dialog (修改草稿弹窗) */}
      {activeEditBinding ? (
        <ModalDialog
          open
          onDismiss={closeDialogs}
          className="dts-binding-draft-dialog"
          backdropClassName="dts-binding-draft-dialog__overlay"
        >
          {({ titleId }) => (
            <div className="dts-binding-draft-dialog__content">
              <div className="dts-binding-draft-dialog__header">
                <div>
                  <h2 id={titleId}>修改草稿</h2>
                  <p>编辑 JSON 参数目标值与原因，提交后进入草稿变更集。</p>
                </div>
                <button
                  type="button"
                  className="button ghost dts-binding-draft-dialog__close"
                  aria-label="关闭"
                  onClick={closeDialogs}
                >
                  <CircleX size={18} aria-hidden="true" />
                </button>
              </div>

              <article
                className="dts-binding-draft-card"
                aria-label={`${activeEditBinding.propertyKey} 草稿`}
              >
                <div className="dts-binding-draft-card__head">
                  <div>
                    <strong><code>{activeEditBinding.propertyKey}</code></strong>
                    <small>
                      {activeEditBinding.moduleId ?? activeEditBinding.driverModule ?? "固定配置"} · {activeEditBinding.instanceName ?? "器件实例不可用"}
                    </small>
                  </div>
                </div>

                <p className="dts-binding-draft-card__context">
                  <code>{activeEditBinding.locator ?? activeEditBinding.propertyKey}</code>
                </p>

                <div className="dts-binding-draft-card__documentation">
                  <strong>参数说明</strong>
                  <p>
                    JSON 格式固定参数。校验通过后生成草稿变更，经审核后生效。
                  </p>
                </div>

                <div className="dts-binding-draft-card__preview" aria-label={`${activeEditBinding.propertyKey} 当前到目标预览`}>
                  <div className="json-binding-card__preview-label">当前值</div>
                  <pre className="json-binding-card__preview-code">
                    {activeEditBinding.rawValue}
                  </pre>
                </div>

                <div className="json-binding-card__form">
                  <div className="json-binding-card__field">
                    <label htmlFor={`${diagnosticId}-value`}>目标值</label>
                    <Textarea
                      id={`${diagnosticId}-value`}
                      ref={targetInputRef}
                      aria-label="目标值"
                      aria-invalid={diagnostics.length > 0}
                      aria-describedby={diagnostics.length > 0 ? diagnosticId : undefined}
                      value={draftRaw}
                      disabled={!canEdit || validating}
                      rows={5}
                      className="dts-binding-draft-card__code-editor"
                      placeholder="输入合法的 JSON 字符串..."
                      onChange={(e) => {
                        setDraftRaw(e.target.value);
                        setDiagnostics([]);
                      }}
                    />
                    {syntaxStatus ? (
                      <div className={`json-binding-card__syntax-status is-${syntaxStatus.valid ? "valid" : "invalid"}`}>
                        {syntaxStatus.valid ? (
                          <CheckCircle2 size={13} aria-hidden="true" />
                        ) : (
                          <AlertCircle size={13} aria-hidden="true" />
                        )}
                        <span>{syntaxStatus.message}</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="json-binding-card__field">
                    <label htmlFor={`${diagnosticId}-reason`}>修改原因</label>
                    <Textarea
                      id={`${diagnosticId}-reason`}
                      aria-label="修改原因"
                      value={draftReason}
                      disabled={!canEdit || validating}
                      rows={2}
                      placeholder={`说明为什么要修改 ${activeEditBinding.propertyKey}...`}
                      onChange={(e) => {
                        setDraftReason(e.target.value);
                        setDiagnostics([]);
                      }}
                    />
                  </div>

                  {diagnostics.length > 0 ? (
                    <ul id={diagnosticId} aria-label="编辑诊断" role="alert" className="json-binding-card__alert">
                      {diagnostics.map((item) => (
                        <li key={`${item.code ?? ""}:${item.message}`}>
                          {presentError(new Error(item.message), "目标值未通过校验，请检查格式、范围及来源版本后重试。")}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {onLoadHistory ? (
                    <div className="json-binding-card__history-in-draft">
                      <button
                        type="button"
                        className="button subtle"
                        onClick={() => loadHistoryFor(activeEditBinding.id)}
                        disabled={historyLoading}
                      >
                        <History size={13} aria-hidden="true" />
                        {historyLoading ? "加载历史中…" : "查看固定值历史"}
                      </button>
                      {onExportBinding ? (
                        <button
                          type="button"
                          className="button subtle"
                          disabled={exportingId === activeEditBinding.id}
                          onClick={() => handleExport(activeEditBinding.id)}
                        >
                          <Download size={13} aria-hidden="true" />
                          {exportingId === activeEditBinding.id ? "导出中…" : "导出源文件"}
                        </button>
                      ) : null}
                      {exportError ? <p role="alert" className="json-parameter-workbench__error">{exportError}</p> : null}
                      {historyError ? <p role="alert" className="json-parameter-workbench__error">{historyError}</p> : null}
                      {history.length > 0 ? (
                        <ol className="json-binding-card__history-timeline">
                          {history.map((entry) => (
                            <li key={entry.id} className="json-binding-card__history-entry">
                              <time dateTime={entry.createdAt}>{formatRelativeOrAbsolute(entry.createdAt)}</time> · {entry.valueState === "deleted"
                                ? "删除属性 · " : entry.valueState === "present" ? "更新属性 · " : ""}{entry.reason}
                            </li>
                          ))}
                        </ol>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>

              <div className="dts-binding-draft-dialog__footer">
                <button
                  type="button"
                  className="button subtle is-primary"
                  disabled={!canEdit || validating || !draftReason.trim()}
                  onClick={() => submitDraft("set")}
                >
                  {validating ? "校验中…" : "校验并创建草稿"}
                </button>
                <button
                  type="button"
                  className="button subtle is-danger"
                  disabled={!canEdit || validating || !draftReason.trim()}
                  onClick={() => submitDraft("delete")}
                >
                  创建删除草稿
                </button>
                <button
                  type="button"
                  className="button subtle"
                  onClick={closeDialogs}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </ModalDialog>
      ) : null}
    </section>
  );
}
