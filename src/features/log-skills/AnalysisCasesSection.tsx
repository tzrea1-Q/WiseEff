import { useCallback, useEffect, useState } from "react";
import { DataTable } from "@/components/admin/DataTable";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { AnalysisTrace } from "@/features/log-analysis/AnalysisTrace";
import { presentError } from "@/infrastructure/http/presentError";
import { AnalysisCaseDialog, emptyCaseExpectations, presentAnalysisCaseError } from "./AnalysisCaseDialog";
import type { AnalysisCase, AnalysisCaseInput, AnalysisCaseList, AnalysisCaseRun, AnalysisTraceStep, SkillWorkspaceRepository } from "./types";

const score = (value: number) => Number(value.toFixed(2)).toString();
const delta = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : "−"}${score(Math.abs(value))}`;

export function AnalysisCasePublishSummary({ skillId, draftId, dirty, repository, onRun }: {
  skillId: string; draftId?: string; dirty: boolean; repository?: Partial<SkillWorkspaceRepository>; onRun: () => void;
}) {
  const [data, setData] = useState<AnalysisCaseList | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    if (repository?.listAnalysisCases) void repository.listAnalysisCases(skillId).then((value) => { if (active) setData(value); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [repository, skillId, draftId]);
  if (!repository?.listAnalysisCases || (data && !data.items.length)) return null;
  const run = data?.latestRun;
  const current = data?.current && !dirty && run?.status === "complete" && run.skillRevisionId === draftId
    && run.results.length === data.items.length;
  const improved = run?.results.filter((result) => (result.delta ?? 0) > 0).length ?? 0;
  const regressed = run?.results.filter((result) => (result.delta ?? 0) < 0).length ?? 0;
  return <div aria-label="分析用例发布摘要">
    {current ? <p>分析用例：通过 {run.results.filter((result) => result.draft.passed).length} / {data!.items.length}（较已发布 +{improved} / −{regressed}）</p>
      : <><p>{failed ? "分析用例结果暂不可用。" : "分析用例尚未针对当前草稿完整运行。"}</p><Button type="button" variant="link" onClick={onRun}>运行分析用例</Button></>}
    <p>测试结果仅供参考，不阻止发布。</p>
  </div>;
}

export function AnalysisCasesSection({ skillId, repository, canEdit, beforeRun }: {
  skillId: string; repository?: Partial<SkillWorkspaceRepository>; canEdit: boolean; beforeRun: () => Promise<unknown>;
}) {
  const [data, setData] = useState<AnalysisCaseList | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<AnalysisCase | "new" | null>(null);
  const [deleting, setDeleting] = useState<AnalysisCase | null>(null);
  const [trace, setTrace] = useState<{ name: string; steps: AnalysisTraceStep[]; report: AnalysisCaseRun["results"][number]["draft"]["report"] } | null>(null);
  const refresh = useCallback(async () => { if (repository?.listAnalysisCases) setData(await repository.listAnalysisCases(skillId)); }, [repository, skillId]);
  useEffect(() => { let active = true; if (repository?.listAnalysisCases) void repository.listAnalysisCases(skillId).then((value) => { if (active) setData(value); }, (cause) => { if (active) setError(presentError(cause, "无法加载分析用例。")); }); return () => { active = false; }; }, [repository, skillId]);
  const run = data?.latestRun;
  useEffect(() => {
    if (run?.status !== "processing" || !repository?.getAnalysisCaseRun) return;
    let active = true;
    const timer = setTimeout(() => { void repository.getAnalysisCaseRun!(skillId, run.id).then(async (next) => {
      if (!active) return;
      setData((value) => value ? { ...value, latestRun: next } : value);
      if (next.status !== "processing") await refresh();
    }).catch((cause) => { if (active) setError(presentError(cause, "无法读取分析用例进度，请重试。")); }); }, 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [run, repository, skillId, refresh]);
  const action = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); } catch (cause) { setError(presentAnalysisCaseError(cause, "分析用例操作失败，请重试。")); }
    finally { setBusy(false); }
  };
  const start = (caseIds?: string[]) => void action(async () => {
    await beforeRun();
    setData((value) => value ? { ...value, current: false } : value);
    const started = await repository!.startAnalysisCaseRun!(skillId, caseIds);
    setData((value) => value ? { ...value, latestRun: started, current: false } : value);
  });
  if (!repository?.listAnalysisCases) return <section className="skill-section" aria-label="分析用例"><h2>分析用例</h2><p>请在 API 模式下管理分析用例。</p></section>;
  if (!data && !error) return <SectionSkeleton label="正在加载分析用例" />;
  if (!data) return <SectionError message={error} onRetry={() => void action(refresh)} />;
  const disabled = !canEdit || busy || run?.status === "processing";
  const lastResult = (caseId: string) => {
    const result = run?.results.find((value) => value.caseId === caseId);
    return result ? { runId: run!.id, result } : data.lastResults?.find((value) => value.result.caseId === caseId);
  };
  const saveCase = async (input: AnalysisCaseInput) => {
    if (editing && editing !== "new") await repository.updateAnalysisCase!(skillId, editing.id, input);
    else await repository.createAnalysisCase!(skillId, input);
    await refresh();
  };
  return <section className="skill-section skill-analysis-cases" aria-label="分析用例">
    <h2>分析用例</h2><p>对比草稿与上一已发布版本的质量评分；运行不会生成日志记录。</p>
    <div className="flex flex-wrap items-center gap-2">
      {canEdit ? <><Button disabled={disabled || data.items.length >= 20} onClick={() => setEditing("new")}>添加分析用例</Button>
        <Button variant="outline" disabled={disabled || !data.items.length || !repository.startAnalysisCaseRun} onClick={() => start()}>运行全部用例</Button>
        <label className="button subtle">导入用例<input aria-label="导入分析用例 ZIP" type="file" accept=".zip" disabled={disabled} onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (file) void action(async () => { await repository.importAnalysisCases!(skillId, file); await refresh(); });
        }} /></label></> : null}
      <Button variant="outline" disabled={busy || !data.items.length} onClick={() => void action(async () => {
        const blob = await repository.exportAnalysisCases!(skillId); const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = "analysis-cases.zip"; anchor.click(); URL.revokeObjectURL(url);
      })}>导出用例</Button>
    </div>
    {run ? <div role="status" aria-live="polite"><p>{run.status === "processing" ? `正在运行分析用例… ${run.progress}%` : run.status === "complete" ? "分析用例运行完成" : "分析用例运行失败"}</p>
      {run.status === "processing" ? <progress aria-label="分析用例运行进度" max={100} value={run.progress} /> : null}
      {!data.current && run.status !== "processing" ? <p>以下为历史结果，请针对当前草稿重新运行。</p> : null}
      {run.error ? <p role="alert">分析用例运行失败或已中断，请重试。</p> : null}</div> : null}
    {error ? <div role="alert"><p>{error}</p><Button variant="link" onClick={() => void action(refresh)}>重新加载</Button></div> : null}
    <DataTable fluid rows={data.items} rowKey={(item) => item.id} ariaLabel="分析用例列表" emptyMessage="还没有分析用例，添加日志包和期望结果后开始回归测试。" columns={[
      { key: "name", header: "用例", render: (item) => <><strong>{item.name}</strong><p>{item.files.map((file) => file.path).join("、")}</p></> },
      { key: "scores", header: "草稿 / 已发布 / 变化", render: (item) => { const last = lastResult(item.id); const result = last?.result; return result ? <>
        {last!.runId !== run?.id || !data.current ? <p>历史结果</p> : null}
        <p>草稿 {score(result.draft.score)} · {result.draft.passed ? "通过" : "未通过"}</p>
        <p>已发布 {result.published ? `${score(result.published.score)} · ${result.published.passed ? "通过" : "未通过"}` : "—"}</p><p>变化 {delta(result.delta)}</p></> : "尚未运行"; } },
      { key: "actions", header: "操作", render: (item) => <div className="flex flex-wrap gap-2">
        {canEdit ? <><Button size="sm" variant="outline" disabled={disabled} onClick={() => setEditing(item)}>编辑</Button>
          <Button size="sm" variant="outline" disabled={disabled || !repository.startAnalysisCaseRun} onClick={() => start([item.id])}>运行</Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => setDeleting(item)}>删除</Button></> : null}
        {(["draft", "published"] as const).map((revision) => { const last = lastResult(item.id); const result = last?.result; return result?.[revision] ? <Button key={revision} size="sm" variant="link" disabled={busy} onClick={() => void action(async () => {
          const steps = await repository.getAnalysisCaseTrace!(skillId, last!.runId, item.id, revision);
          setTrace({ name: `${item.name} · ${revision === "draft" ? "草稿" : "已发布"}`, steps, report: result[revision]!.report });
        })}>{revision === "draft" ? "草稿轨迹" : "已发布轨迹"}</Button> : null; })}
      </div> }
    ]} />
    {editing ? <AnalysisCaseDialog key={editing === "new" ? "new" : editing.id} title={editing === "new" ? "添加分析用例" : "编辑分析用例"}
      initial={editing === "new" ? { name: "", expectations: emptyCaseExpectations } : editing} uploadRequired={editing === "new"} onSave={saveCase} onClose={() => setEditing(null)} /> : null}
    <ConfirmDialog open={!!deleting} title="删除分析用例？" description={`将删除「${deleting?.name ?? ""}」及其日志包。`} confirmLabel="删除" pending={busy}
      onCancel={() => setDeleting(null)} onConfirm={() => void action(async () => { await repository.deleteAnalysisCase!(skillId, deleting!.id); setDeleting(null); await refresh(); })} />
    <ModalDialog open={!!trace} onDismiss={() => setTrace(null)} className="skill-authoring-dialog modal-card--lg">
      {({ titleId }) => <><h2 id={titleId}>分析轨迹 · {trace?.name}</h2><AnalysisTrace steps={trace?.steps ?? []} analysis={trace?.report ?? undefined} /><Button variant="outline" onClick={() => setTrace(null)}>关闭</Button></>}
    </ModalDialog>
  </section>;
}
