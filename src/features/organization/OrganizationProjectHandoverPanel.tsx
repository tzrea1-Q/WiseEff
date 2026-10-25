import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createDefaultApiClient } from "@/infrastructure/http/defaultApiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SettingsLeaveGuard } from "@/components/layout/SettingsFormPage";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { withOrganizationScope } from "@/infrastructure/http/organizationScope";
import { createHttpParameterInitializationRepository } from "@/infrastructure/http/parameterInitializationClient";
import type { InitializationDraftDto, ProjectInitializationStatus } from "@/domain/parameters/initializationTypes";
import { Textarea } from "@/components/ui/textarea";
import { historicalIdentityLabel, type HistoricalAttribution } from "@/domain/identity/historicalAttribution";

const labels = { "parameter-draft": "参数与节点草稿", "value-draft": "参数值草稿", "source-draft": "配置源码草稿", "initialization-draft": "项目初始化", "hardware-review": "硬件审核职责", "software-review": "软件审核职责", "software-merge": "软件合入职责", "value-review": "配置审核待办" };
type Kind = keyof typeof labels;
type Work = { id: string; kind: Kind; projectId: string; projectName: string; title: string; responsibleUserId: string | null; responsibleUserName: string | null; pending: boolean; version: string; historicalAttribution: HistoricalAttribution; candidates: Array<{ id: string; name: string }> };
const originalAuthor = (item: Work) => historicalIdentityLabel(item.historicalAttribution.actors[item.kind === "source-draft" || item.kind === "initialization-draft" ? "created_by_user_id" : item.kind.endsWith("draft") ? "user_id" : "submitter_user_id"]);

export function OrganizationProjectHandoverPanel({ organizationId, currentUserId, pendingOnly, onNavigate, refreshSignal, hideEmpty = false, onVisibleCountChange }: {
  organizationId?: string; currentUserId: string; pendingOnly: boolean; onNavigate: (path: string) => void; refreshSignal: number;
  hideEmpty?: boolean; onVisibleCountChange?: (count: number | null) => void;
}) {
  const client = useMemo(() => createDefaultApiClient({ organizationId }), [organizationId]);
  const [items, setItems] = useState<Work[] | null>(null), [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0), [assignment, setAssignment] = useState<Work | null>(null), [successor, setSuccessor] = useState("");
  const [continueAfter, setContinueAfter] = useState(false), [saving, setSaving] = useState(false), [assignmentError, setAssignmentError] = useState("");
  const [continuation, setContinuation] = useState<Work | null>(null);
  const initialization = useMemo(() => createHttpParameterInitializationRepository(client), [client]);
  const [initialDraft, setInitialDraft] = useState<InitializationDraftDto | null>(null), [initialStatus, setInitialStatus] = useState<ProjectInitializationStatus>("not_initialized"), [notes, setNotes] = useState("");
  const generation = useRef(0);
  const reload = () => setAttempt(value => value + 1);
  useEffect(() => {
    const current = ++generation.current; setError(""); setLoading(true);
    void client.get<{ items: Work[] }>("/api/v1/organization/project-handovers").then(result => { if (generation.current === current) setItems(result.items); })
      .catch((failure: unknown) => { if (generation.current === current) setError(presentError(failure, "项目交接清单加载失败。")); })
      .finally(() => { if (generation.current === current) setLoading(false); });
    return () => { generation.current++; };
  }, [client, attempt, refreshSignal]);
  const navigate = useCallback(async (item: Work) => {
    if (item.kind === "initialization-draft") {
      try {
        const state = await initialization.getInitialization(item.projectId);
        if (!state.draft) throw new Error("初始化草稿已不存在，请刷新清单。");
        setInitialDraft(state.draft); setInitialStatus(state.status); setNotes(state.draft.notes); setAssignmentError("");
      } catch (failure) { setError(presentError(failure, "初始化草稿加载失败。")); }
      return;
    }
    if (item.kind === "source-draft") {
      onNavigate(withOrganizationScope(`/parameter-admin/projects/${encodeURIComponent(item.projectId)}/configuration?sourceMode=candidate&candidate=${encodeURIComponent(item.id)}`, organizationId)); return;
    }
    const params = new URLSearchParams({ project: item.projectId });
    if (!item.kind.endsWith("draft")) params.set(item.kind === "value-review" ? "request" : "legacyRequest", item.id);
    onNavigate(withOrganizationScope(`${item.kind.endsWith("draft") ? "/parameters" : "/parameter-review"}?${params}`, organizationId));
  }, [initialization, onNavigate, organizationId]);
  useEffect(() => {
    if (continuation && !saving && !assignment) {
      setContinuation(null);
      void navigate(continuation);
    }
  }, [continuation, saving, assignment, navigate]);
  const saveInitialization = async (submit: boolean) => {
    if (!initialDraft) return;
    setSaving(true); setAssignmentError("");
    try {
      const draft = await initialization.upsertDraft({ ...initialDraft, ownerUserId: initialDraft.ownerUserId ?? currentUserId, notes });
      if (submit) { await initialization.submit(draft.projectId); setInitialDraft(null); }
      else setInitialDraft(draft);
      reload();
    } catch (failure) { setAssignmentError(presentError(failure, "初始化保存失败。")); }
    finally { setSaving(false); }
  };
  const openAssignment = (item: Work, takeOver = false) => {
    setAssignment(item); setSuccessor(takeOver ? currentUserId : item.pending ? "" : item.responsibleUserId ?? "");
    setContinueAfter(takeOver); setAssignmentError("");
  };
  const save = async () => {
    if (!assignment) return;
    setSaving(true); setAssignmentError("");
    try {
      await client.patch(`/api/v1/organization/project-handovers/${assignment.kind}/${encodeURIComponent(assignment.id)}`, { responsibleUserId: successor || null, expectedVersion: assignment.version });
      setAssignment(null); reload(); if (continueAfter) setContinuation(assignment);
    } catch (failure) { setAssignmentError(presentError(failure, "项目交接失败，请刷新后重试。")); }
    finally { setSaving(false); }
  };
  const visibleItems = items?.filter(item => !pendingOnly || item.pending);
  const visibleCount = !visibleItems || error || loading ? null : visibleItems.length;
  useEffect(() => { onVisibleCountChange?.(visibleCount); }, [visibleCount, onVisibleCountChange]);
  if (!items) return error ? <section aria-label="项目业务交接"><h3>项目业务交接</h3><SectionError message={error} onRetry={reload} /></section> : <SectionSkeleton label="正在加载项目交接" />;
  if (hideEmpty && !error && !visibleItems?.length) return null;
  return <section aria-label="项目业务交接" className="flex flex-col gap-3">
    {error ? <SectionError message={error} onRetry={reload} /> : null}
    <AdminListPage label="项目业务交接" headerContent="项目业务交接" headerActions={null} filterBar={null}
      table={{ ariaLabel: "项目业务交接", rows: visibleItems ?? [], rowKey: item => `${item.kind}:${item.id}`, columns: [
        { key: "project", header: "项目", render: item => item.projectName },
        { key: "work", header: "待办与职责", render: item => <div><p className="font-medium">{item.title}</p><p className="text-xs text-muted-foreground">{labels[item.kind]} · 原作者：{originalAuthor(item)}</p></div> },
        { key: "responsible", header: "当前责任人", render: item => item.responsibleUserName ?? "未指定" },
        { key: "pending", header: "交接状态", render: item => <Badge variant={item.pending ? "outline" : "secondary"}>{item.pending ? "待交接" : "已分配"}</Badge> }
      ] }} rowActions={item => ({ label: item.title, primaryAction: item.kind.endsWith("draft")
        ? { id: "continue", label: item.responsibleUserId === currentUserId ? "继续处理" : "接管并继续", onSelect: () => item.responsibleUserId === currentUserId ? navigate(item) : openAssignment(item, true) }
        : { id: "assign", label: "指派处理人", onSelect: () => openAssignment(item) },
        items: [...(item.kind.endsWith("draft") ? [{ id: "assign", label: "指定接任者", onSelect: () => openAssignment(item) }] : []), { id: "open", label: "打开项目业务", onSelect: () => navigate(item) }] })}
      emptyState={{ title: "暂无待交接项目业务", message: pendingOnly ? "取消待交接筛选，可查看已分配的草稿及审核、合入职责。" : "当前没有未完成的项目业务。" }} />
    <SettingsLeaveGuard dirty={Boolean(assignment && successor !== (assignment.responsibleUserId ?? "")) || Boolean(initialDraft && notes !== initialDraft.notes)} saving={saving} />
    <ModalDialog open={Boolean(assignment)} onDismiss={async () => { if (!saving && await requestSettingsLeave()) setAssignment(null); }} describedBy className="submission-dialog modal-card--sm flex flex-col gap-4">
      {({ titleId, descriptionId }) => <><h2 id={titleId}>{continueAfter ? "接管项目草稿" : "指定项目接任者"}</h2><p id={descriptionId} className="text-sm text-muted-foreground">{assignment?.projectName} · {assignment?.title}。原始作者和历史署名保留；已有同一参数草稿时不会覆盖。</p>
        <SelectControl ariaLabel="项目接任者" value={successor} onValueChange={setSuccessor} disabled={saving || continueAfter} options={[{ value: "", label: "待交接" }, ...(assignment?.candidates ?? []).map(candidate => ({ value: candidate.id, label: candidate.name }))]} />
        {assignmentError ? <p role="alert" className="text-destructive">{assignmentError}</p> : null}
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={async () => { if (await requestSettingsLeave()) setAssignment(null); }}>关闭</Button><Button disabled={saving} onClick={() => void save()}>{continueAfter ? "确认接管并继续" : "保存项目交接"}</Button></div></>}
    </ModalDialog>
    <ModalDialog open={Boolean(initialDraft)} onDismiss={async () => { if (!saving && await requestSettingsLeave()) setInitialDraft(null); }} describedBy className="submission-dialog modal-card--sm flex flex-col gap-4">
      {({ titleId, descriptionId }) => <><h2 id={titleId}>继续项目初始化</h2><p id={descriptionId}>{initialDraft?.projectName} · {initialDraft?.emptyLibrary ? "从空项目开始" : `保留 ${initialDraft?.bindingSnapshots.length ?? 0} 项来源快照`}</p>
        {initialStatus === "initialization_pending_review" ? <p role="status">该初始化已经提交，等待管理员在参数审核中处理。原始提交署名保留。</p> : <label className="flex flex-col gap-2 text-sm">初始化说明<Textarea value={notes} onChange={event => setNotes(event.target.value)} disabled={saving} /></label>}
        {assignmentError ? <p role="alert" className="text-destructive">{assignmentError}</p> : null}
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={async () => { if (await requestSettingsLeave()) setInitialDraft(null); }}>关闭</Button>{initialStatus !== "initialization_pending_review" ? <><Button variant="outline" disabled={saving} onClick={() => void saveInitialization(false)}>保存初始化草稿</Button><Button disabled={saving} onClick={() => void saveInitialization(true)}>提交初始化审核</Button></> : <Button onClick={() => { setInitialDraft(null); onNavigate(withOrganizationScope(`/parameter-review?project=${encodeURIComponent(initialDraft!.projectId)}`, organizationId)); }}>前往参数审核</Button>}</div></>}
    </ModalDialog>
  </section>;
}
