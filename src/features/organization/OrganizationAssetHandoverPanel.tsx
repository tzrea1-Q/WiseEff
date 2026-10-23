import { useEffect, useMemo, useRef, useState } from "react";
import { createDefaultApiClient } from "@/infrastructure/http/defaultApiClient";
import { createHttpKnowledgeRepository } from "@/infrastructure/http/knowledgeClient";
import { createHttpProductFeedbackRepository } from "@/infrastructure/http/productFeedbackClient";
import { resolveWiseEffApiBaseUrl } from "@/infrastructure/http/runtimeMode";
import { presentError } from "@/infrastructure/http/presentError";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SettingsLeaveGuard } from "@/components/layout/SettingsFormPage";
import { KnowledgeEntryEditorDialog } from "@/features/knowledge/KnowledgeEntryEditorDialog";
import { KnowledgeFileUploadDialog } from "@/features/knowledge/KnowledgeFileUploadDialog";
import { KnowledgeImportDialog } from "@/features/knowledge/KnowledgeImportDialog";
import { FeedbackDialog } from "@/features/product-feedback/FeedbackDialog";
import { FeedbackAdminDrawer } from "@/features/product-feedback/FeedbackAdminDrawer";
import type { KnowledgeEntry } from "@/domain/knowledge/types";
import type { ProductFeedback } from "@/domain/productFeedback/types";
import type { UpdateKnowledgeInput } from "@/application/ports/KnowledgeRepository";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";

type Item = { id: string; kind: "entry" | "import" | "feedback-draft" | "feedback-work"; title: string; responsibleUserId: string | null; responsibleUserName: string | null; pending: boolean };
type Candidate = { id: string; name: string; canTriage?: boolean };
type List = { items: Item[]; candidates: Candidate[] };
const labels = { entry: "知识草稿", import: "未完成导入", "feedback-draft": "反馈草稿", "feedback-work": "反馈处理" };

export function OrganizationAssetHandoverPanel({ organizationId, enabled }: { organizationId?: string; enabled: boolean }) {
  const client = useMemo(() => createDefaultApiClient({ organizationId }), [organizationId]);
  const knowledge = useMemo(() => createHttpKnowledgeRepository({ organizationId }), [organizationId]);
  const feedback = useMemo(() => createHttpProductFeedbackRepository({ apiClient: client, baseUrl: resolveWiseEffApiBaseUrl() }), [client]);
  const [lists, setLists] = useState<{ knowledge: List; feedback: List } | null>(null), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0), [pendingOnly, setPendingOnly] = useState(true);
  const [assignment, setAssignment] = useState<Item | null>(null), [successor, setSuccessor] = useState("");
  const [saving, setSaving] = useState(false), [assignmentError, setAssignmentError] = useState("");
  const [entry, setEntry] = useState<KnowledgeEntry | null>(null), [batchId, setBatchId] = useState<string | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState<ProductFeedback | null>(null), [feedbackWork, setFeedbackWork] = useState<ProductFeedback | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const current = ++generation.current; setError("");
    void Promise.all([client.get<List>("/api/v1/knowledge/handovers"), client.get<List>("/api/v1/product-feedback/handovers")])
      .then(([knowledgeList, feedbackList]) => { if (generation.current === current) setLists({ knowledge: knowledgeList, feedback: feedbackList }); })
      .catch((failure: unknown) => { if (generation.current === current) setError(presentError(failure, "业务交接清单加载失败。")); });
    return () => { generation.current++; };
  }, [enabled, client, attempt]);
  const reload = () => setAttempt(value => value + 1);
  const closeAssignment = async () => { if (await requestSettingsLeave()) setAssignment(null); };
  const assign = async () => {
    if (!assignment) return;
    setSaving(true); setAssignmentError("");
    try {
      const path = assignment.kind.startsWith("feedback-") ? `/api/v1/product-feedback/handovers/${assignment.id}` : `/api/v1/knowledge/handovers/${assignment.kind}/${assignment.id}`;
      await client.patch(path, { responsibleUserId: successor || null, expectedResponsibleUserId: assignment.responsibleUserId });
      setAssignment(null); reload();
    } catch (failure) { setAssignmentError(presentError(failure, "交接失败，请刷新后重试。")); }
    finally { setSaving(false); }
  };
  const continueWork = async (item: Item) => {
    setError("");
    try {
      if (item.kind === "entry") { const next = await knowledge.get(item.id); if (!next) throw new Error("草稿已不存在，请刷新清单。"); setEntry(next); }
      else if (item.kind === "import") setBatchId(item.id);
      else if (item.kind === "feedback-draft") { const next = await feedback.getMine!(item.id); if (!next) throw new Error("草稿已不存在，请刷新清单。"); setFeedbackDraft(next); }
      else { const next = await feedback.get(item.id); if (!next) throw new Error("反馈已不存在，请刷新清单。"); setFeedbackWork(next); }
    } catch (failure) { setError(presentError(failure, "无法继续处理该项业务。")); }
  };
  const saveEntry = async (input: Omit<UpdateKnowledgeInput, "expectedHeadRevisionNumber">) => {
    if (!entry) return;
    await knowledge.update(entry.id, { ...input, expectedHeadRevisionNumber: entry.headRevisionNumber }); reload();
  };
  if (!enabled) return <SectionEmpty message="业务交接需要连接真实 API。" />;
  if (!lists) return error ? <SectionError message={error} onRetry={reload} /> : <SectionSkeleton label="正在加载业务交接" />;
  const candidates = assignment?.kind.startsWith("feedback-") ? lists.feedback.candidates.filter(candidate => assignment.kind !== "feedback-work" || candidate.canTriage) : lists.knowledge.candidates;
  const table = (group: "knowledge" | "feedback", label: string) => <AdminListPage label={label} headerContent={label} headerActions={null} filterBar={null}
    table={{ ariaLabel: label, rows: lists[group].items.filter(item => !pendingOnly || item.pending), rowKey: item => item.id, columns: [
      { key: "title", header: "业务", render: item => <div><p className="font-medium">{item.title}</p><p className="text-xs text-muted-foreground">{labels[item.kind]}</p></div> },
      { key: "responsible", header: "当前责任人", render: item => item.responsibleUserName ?? "未指定" },
      { key: "state", header: "交接状态", render: item => <Badge variant={item.pending ? "outline" : "secondary"}>{item.pending ? "待交接" : "已分配"}</Badge> }
    ] }} rowActions={item => ({ label: item.title, primaryAction: { id: "continue", label: "继续处理", onSelect: () => continueWork(item) }, items: [{ id: "assign", label: "指定接任者", onSelect: () => { setAssignment(item); setSuccessor(item.pending ? "" : item.responsibleUserId ?? ""); setAssignmentError(""); } }] })}
    emptyState={{ title: "暂无待交接事项", message: pendingOnly ? "当前没有无人负责的未完成业务。可取消筛选查看全部未完成业务。" : "当前没有未完成业务。" }} />;
  return <section className="flex flex-col gap-5" aria-label="组织业务交接">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">业务交接</h2><p className="text-sm text-muted-foreground">草稿与历史留在原组织。未指定接任者时，管理员仍可继续处理。</p></div><Button variant="outline" onClick={reload}>刷新交接清单</Button></div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pendingOnly} onChange={event => setPendingOnly(event.target.checked)} />仅显示待交接</label>
    {error ? <SectionError message={error} onRetry={reload} /> : null}
    {table("knowledge", "知识业务交接")}{table("feedback", "反馈业务交接")}
    <p className="text-xs text-muted-foreground">组织机器凭据独立保留。个人密码、会话、Agent 私人对话和设备配对不参与交接；分析技能草稿由组织管理员在技能管理中直接维护。</p>
    <SettingsLeaveGuard dirty={Boolean(assignment && successor !== (assignment.pending ? "" : assignment.responsibleUserId ?? ""))} saving={saving} />
    <ModalDialog open={Boolean(assignment)} onDismiss={() => void closeAssignment()} describedBy className="submission-dialog modal-card--sm flex flex-col gap-4">
      {({ titleId, descriptionId }) => <><h2 id={titleId}>指定接任者</h2><p id={descriptionId} className="text-sm text-muted-foreground">{assignment?.title} · 只调整当前责任，保留创建人和历史署名。</p>
        <SelectControl ariaLabel="接任者" value={successor} onValueChange={setSuccessor} disabled={saving} options={[{ value: "", label: "待交接（管理员可继续处理）" }, ...candidates.map(candidate => ({ value: candidate.id, label: candidate.name }))]} />
        {assignmentError ? <p role="alert" className="text-destructive">{assignmentError}</p> : null}<div className="flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={() => void closeAssignment()}>关闭</Button><Button disabled={saving} onClick={() => void assign()}>保存交接</Button></div></>}
    </ModalDialog>
    <KnowledgeEntryEditorDialog open={entry?.contentForm === "markdown"} entry={entry} onSubmit={saveEntry} onClose={() => setEntry(null)} />
    <KnowledgeFileUploadDialog open={entry?.contentForm === "file"} entry={entry} onSubmit={saveEntry} onClose={() => setEntry(null)} />
    {batchId ? <KnowledgeImportDialog key={batchId} open repository={knowledge} organizationId={organizationId} resumeBatchId={batchId} onClose={() => { setBatchId(null); reload(); }} onComplete={reload} /> : null}
    <FeedbackDialog open={Boolean(feedbackDraft)} initialDraft={feedbackDraft} pagePath="/organization/handovers" pageTitle="业务交接" productFeedbackRepository={feedback} onOpenChange={open => { if (!open) { setFeedbackDraft(null); reload(); } }} />
    <FeedbackAdminDrawer open={Boolean(feedbackWork)} feedback={feedbackWork} onClose={() => { setFeedbackWork(null); reload(); }}
      onUpdate={async (id, input) => { const next = await feedback.update(id, input); setFeedbackWork(next); reload(); return next; }}
      onAppendProgress={async (id, input) => { const next = await feedback.appendProgress!(id, input); setFeedbackWork(next); reload(); return next; }}
      getAttachmentObjectUrl={feedback.getAttachmentObjectUrl} listAssignees={feedback.listAssignees} />
  </section>;
}
