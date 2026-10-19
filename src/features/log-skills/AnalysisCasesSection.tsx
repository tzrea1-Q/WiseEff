import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { DataTable } from "@/components/admin/DataTable";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { RowActionMenu } from "@/components/common/RowActionMenu";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { AnalysisTrace } from "@/features/log-analysis/AnalysisTrace";
import { presentError } from "@/infrastructure/http/presentError";
import { AnalysisCaseDialog, emptyCaseExpectations, presentAnalysisCaseError } from "./AnalysisCaseDialog";
import type { AnalysisCase, AnalysisCaseInput, AnalysisCaseList, AnalysisCaseRun, AnalysisTraceStep, SkillWorkspaceRepository } from "./types";

const score = (value: number) => `${Number(value.toFixed(2))}%`;
const delta = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : "−"}${Number(Math.abs(value).toFixed(2))} 个百分点`;
const qualitySchema = z.object({
  evidence: z.object({ precision: z.number(), recall: z.number(), hitLines: z.array(z.number()), missedLines: z.array(z.number()), extraLines: z.array(z.number()) }).nullable(),
  judge: z.object({ rootCauseScore: z.number(), actionsScore: z.number(), categoryMatch: z.boolean() }).nullable(),
  refusal: z.object({ expected: z.boolean(), refused: z.boolean(), appropriate: z.boolean().nullable() }),
  hallucination: z.object({ rate: z.number(), citedNonexistentLines: z.array(z.number()) }),
  anchorEvidence: z.object({ precision: z.number().nullable(), recall: z.number(), hits: z.array(z.object({ file: z.string(), line: z.number().optional(), pattern: z.string().optional() })),
    misses: z.array(z.object({ file: z.string(), line: z.number().optional(), pattern: z.string().optional() })),
    hallucinatedLines: z.array(z.object({ file: z.string(), line: z.number() })).optional(), hallucinationRate: z.number().optional() }).optional()
});
type Outcome = AnalysisCaseRun["results"][number]["draft"];
const degradation = (outcome: Outcome) => outcome.report.analysisSource === "rules-fallback"
  ? `已降级：${outcome.report.degradedReason === "token-budget-exhausted" ? "Token 预算耗尽，规则回退" : "模型服务不可用，规则回退"}`
  : outcome.report.degradedReason ? "已提前收敛：Token 预算耗尽" : "未降级";
function OutcomeDetails({ outcome, title, fileAnchors, children }: { outcome: Outcome; title: string; fileAnchors: boolean; children: React.ReactNode }) {
  const parsed = qualitySchema.safeParse(outcome.quality);
  const quality = parsed.success ? parsed.data : null;
  const useAnchors = Boolean(quality?.anchorEvidence) || fileAnchors;
  return <section aria-label={`${title}评分详情`} className="skill-case-outcome"><h3>{title} · {score(outcome.score)} · {outcome.passed ? "通过" : "未通过"}</h3>
    <p>{degradation(outcome)}</p><p>{outcome.report.conclusion}</p>
    {quality ? <dl className="skill-facts">
      <dt>证据准确率 / 召回率</dt><dd>{useAnchors ? quality.anchorEvidence
        ? `${quality.anchorEvidence.precision === null ? "未提供" : score(quality.anchorEvidence.precision * 100)} / ${score(quality.anchorEvidence.recall * 100)}`
        : "文件证据评分未保存，请重新运行。" : quality.evidence ? `${score(quality.evidence.precision * 100)} / ${score(quality.evidence.recall * 100)}` : "拒答用例不计证据评分"}</dd>
      <dt>命中 / 遗漏证据</dt><dd>{useAnchors ? quality.anchorEvidence
        ? [quality.anchorEvidence.hits, quality.anchorEvidence.misses].map((values) => values.map((anchor) => `${anchor.file}:${anchor.line ?? anchor.pattern}`).join("、") || "无").join(" / ")
        : "未保存" : quality.evidence ? [quality.evidence.hitLines, quality.evidence.missedLines].map((values) => values.join("、") || "无").join(" / ") : "不适用"}</dd>
      {!useAnchors && quality.evidence ? <><dt>多余证据行</dt><dd>{quality.evidence.extraLines.join("、") || "无"}</dd></> : null}
      <dt>根因覆盖 / 建议动作覆盖</dt><dd>{quality.judge ? `${score(quality.judge.rootCauseScore * 100)} / ${score(quality.judge.actionsScore * 100)}` : "不适用"}</dd>
      <dt>根因分类</dt><dd>{quality.judge ? quality.judge.categoryMatch ? "匹配" : "不匹配" : "不适用"}</dd>
      <dt>拒答</dt><dd>期望{quality.refusal.expected ? "拒答" : "诊断"}；实际{quality.refusal.refused ? "拒答" : "诊断"}；{quality.refusal.appropriate === null ? "不适用" : quality.refusal.appropriate ? "符合期望" : "不符合期望"}</dd>
      <dt>虚构证据</dt><dd>{useAnchors ? quality.anchorEvidence?.hallucinatedLines
        ? `${quality.anchorEvidence.hallucinationRate === undefined ? "比率未保存" : score(quality.anchorEvidence.hallucinationRate * 100)}；不存在的文件或行：${quality.anchorEvidence.hallucinatedLines.map((anchor) => `${anchor.file}:${anchor.line}`).join("、") || "无"}`
        : "文件证据虚构检查未保存，请重新运行。"
        : `${score(quality.hallucination.rate * 100)}；不存在的行：${quality.hallucination.citedNonexistentLines.join("、") || "无"}`}</dd>
    </dl> : <p>该历史运行未保存评分明细，请重新运行。</p>}
    <details><summary>报告证据与建议</summary><ul>{outcome.report.evidence.map((item, index) => <li key={index}>{item.filePath ?? "日志"}:{item.lineNumbers.join("、")} · {item.inference}</li>)}</ul>
      <ul>{outcome.report.suggestedActions.map((action, index) => <li key={index}>{action}</li>)}</ul></details>
    {children}</section>;
}

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
  const [details, setDetails] = useState<{ name: string; runId: string; fileAnchors: boolean; result: AnalysisCaseRun["results"][number] } | null>(null);
  const [traces, setTraces] = useState<Partial<Record<"draft" | "published", AnalysisTraceStep[]>>>({});
  const [importStatus, setImportStatus] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
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
    <h2>分析用例</h2><p>对比草稿与上一已发布版本的质量评分（0–100%），变化以百分点计；运行不会生成日志记录。</p>
    <div className="flex flex-wrap items-center gap-2">
      {canEdit ? <><Button disabled={disabled || data.items.length >= 20} onClick={() => setEditing("new")}>添加分析用例</Button>
        <Button variant="outline" disabled={disabled || !data.items.length || !repository.startAnalysisCaseRun} onClick={() => start()}>运行全部用例</Button>
        <Button variant="outline" disabled={disabled} onClick={() => importInput.current?.click()}>导入用例</Button>
        <input ref={importInput} hidden aria-label="导入分析用例 ZIP" type="file" accept=".zip" disabled={disabled} onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (file) { setImportStatus(`正在导入 ${file.name}…`); void action(async () => {
            try { await repository.importAnalysisCases!(skillId, file); await refresh(); setImportStatus(`已导入 ${file.name}`); }
            catch (cause) { setImportStatus(`导入 ${file.name} 失败`); throw cause; }
          }); }
        }} /></> : null}
      <Button variant="outline" disabled={busy || !data.items.length} onClick={() => void action(async () => {
        const blob = await repository.exportAnalysisCases!(skillId); const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = "analysis-cases.zip"; anchor.click(); URL.revokeObjectURL(url);
      })}>导出用例</Button>
    </div>
    {importStatus ? <p role="status">{importStatus}</p> : null}
    {run ? <div role="status" aria-live="polite"><p>{run.status === "processing" ? `正在运行分析用例… ${run.progress}%` : run.status === "complete" ? "分析用例运行完成" : "分析用例运行失败"}</p>
      {run.status === "processing" ? <progress aria-label="分析用例运行进度" max={100} value={run.progress} /> : null}
      {!data.current && run.status !== "processing" ? <p>以下为历史结果，请针对当前草稿重新运行。</p> : null}
      {run.error ? <p role="alert">分析用例运行失败或已中断，请重试。</p> : null}</div> : null}
    {error ? <div role="alert"><p>{error}</p><Button variant="link" onClick={() => void action(refresh)}>重新加载</Button></div> : null}
    <DataTable fluid rows={data.items} rowKey={(item) => item.id} ariaLabel="分析用例列表" emptyMessage="还没有分析用例，添加日志包和期望结果后开始回归测试。" columns={[
      { key: "name", header: "用例", render: (item) => <><strong>{item.name}</strong><p>{item.files.map((file) => file.path).join("、")}</p></> },
      { key: "scores", header: "草稿 / 已发布 / 变化", render: (item) => { const last = lastResult(item.id); const result = last?.result; return result ? <>
        {last!.runId !== run?.id || !data.current ? <p>历史结果</p> : null}
        <p>草稿 {score(result.draft.score)} · {result.draft.passed ? "通过" : "未通过"} · {degradation(result.draft)}</p>
        <p>已发布 {result.published ? `${score(result.published.score)} · ${result.published.passed ? "通过" : "未通过"} · ${degradation(result.published)}` : "—"}</p><p>变化 {delta(result.delta)}</p></> : "尚未运行"; } },
      { key: "actions", header: "操作", render: (item) => { const last = lastResult(item.id); return <RowActionMenu label={`${item.name}操作`}
        primaryAction={last ? { id: "details", label: "查看结果", disabled: busy, onSelect: () => { setTraces({}); setDetails({ name: item.name, fileAnchors: Boolean(item.expectations.keyEvidence?.length), ...last }); } }
          : canEdit ? { id: "run", label: "运行", disabled: disabled || !repository.startAnalysisCaseRun, onSelect: () => start([item.id]) } : undefined}
        items={canEdit ? [{ id: "run", label: "运行", disabled: disabled || !repository.startAnalysisCaseRun, onSelect: () => start([item.id]) },
          { id: "edit", label: "编辑", disabled, onSelect: () => setEditing(item) },
          { id: "delete", label: "删除", disabled, destructive: true, onRequestConfirmation: () => setDeleting(item) }] : []} />; } }
    ]} />
    {editing ? <AnalysisCaseDialog key={editing === "new" ? "new" : editing.id} title={editing === "new" ? "添加分析用例" : "编辑分析用例"}
      initial={editing === "new" ? { name: "", expectations: emptyCaseExpectations } : editing} availableFiles={editing === "new" ? [] : editing.files} uploadRequired={editing === "new"} onSave={saveCase} onClose={() => setEditing(null)} /> : null}
    <ConfirmDialog open={!!deleting} title="删除分析用例？" description={`将删除「${deleting?.name ?? ""}」及其日志包。`} confirmLabel="删除" pending={busy}
      onCancel={() => setDeleting(null)} onConfirm={() => void action(async () => { await repository.deleteAnalysisCase!(skillId, deleting!.id); setDeleting(null); await refresh(); })} />
    <ModalDialog open={!!details} onDismiss={() => setDetails(null)} className="skill-authoring-dialog skill-case-results modal-card--lg">
      {({ titleId }) => <><h2 id={titleId}>用例结果 · {details?.name}</h2>
        <div className="skill-case-results-grid">{details ? (["draft", "published"] as const).map((revision) => { const outcome = details.result[revision]; const title = revision === "draft" ? "草稿" : "已发布";
          return outcome ? <OutcomeDetails key={revision} outcome={outcome} title={title} fileAnchors={details.fileAnchors}>
            <details><summary>{title}分析轨迹</summary><Button size="sm" variant="outline" disabled={busy} onClick={() => void action(async () => {
              const steps = await repository.getAnalysisCaseTrace!(skillId, details.runId, details.result.caseId, revision);
              setTraces((value) => ({ ...value, [revision]: steps }));
            })}>{traces[revision] ? "刷新轨迹" : "加载轨迹"}</Button>
              {traces[revision] ? <AnalysisTrace steps={traces[revision]} analysis={outcome.report} /> : null}</details>
          </OutcomeDetails> : null; }) : null}</div>
        <Button variant="outline" onClick={() => setDetails(null)}>关闭</Button></>}
    </ModalDialog>
  </section>;
}
