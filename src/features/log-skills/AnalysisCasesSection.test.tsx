import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalysisCasesSection, AnalysisCasePublishSummary } from "./AnalysisCasesSection";
import { AnalysisCaseDialog, emptyCaseExpectations } from "./AnalysisCaseDialog";
import { SkillWorkspace } from "./SkillWorkspace";
import { mockSkillWorkspace } from "@/infrastructure/mock/logSkills";
import type { AnalysisCase, AnalysisCaseRun } from "./types";

afterEach(cleanup);
const item: AnalysisCase = { id: "case", name: "热保护", expectations: { ...emptyCaseExpectations, summary: "热保护", rootCausePoints: ["温度过高"],
  keyEvidence: [{ file: "device.log", line: 2 }], expectedActions: ["检查散热"] }, files: [{ path: "device.log", sizeBytes: 40, lineCount: 2,
  encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null }], createdAt: "2026-10-19", updatedAt: "2026-10-19" };
const report = { confidence: 0.9, conclusion: "温度过高", impact: "限流", severity: "Warning" as const, suggestedActions: ["检查散热"],
  evidence: [], reportContext: { lineCount: 2, entryCount: 2 } };
const run: AnalysisCaseRun = { id: "run", skillRevisionId: "draft", publishedRevisionId: "published", status: "complete", progress: 100,
  results: [{ caseId: "case", name: "热保护", draft: { score: 80, passed: true, report, traceReference: "trace-draft" },
    published: { score: 60, passed: false, report, traceReference: "trace-published" }, delta: 20 }], error: null, createdAt: "2026-10-19" };

describe("analysis cases", () => {
  it("lists scores, edits expectations, runs one or all and inspects the shared trace", async () => {
    let latestRun: AnalysisCaseRun | null = run;
    const repository = { listAnalysisCases: vi.fn(async () => ({ items: [item], latestRun, current: true })),
      updateAnalysisCase: vi.fn(async () => item), startAnalysisCaseRun: vi.fn(async () => {
        latestRun = { ...run, status: "processing", progress: 10 }; return latestRun;
      }), getAnalysisCaseRun: vi.fn(async () => { latestRun = run; return run; }),
      getAnalysisCaseTrace: vi.fn(async () => [{ index: 1, kind: "model-turn" as const, tool: null, arguments: {}, lines: [], resultBytes: 40, outcome: "ok" as const, reason: null }]) };
    const beforeRun = vi.fn(async () => undefined);
    render(<AnalysisCasesSection skillId="skill" repository={repository} canEdit beforeRun={beforeRun} />);
    const table = await screen.findByRole("table", { name: "分析用例列表" });
    expect(table).toHaveTextContent("草稿 80 · 通过"); expect(table).toHaveTextContent("已发布 60 · 未通过"); expect(table).toHaveTextContent("变化 +20");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const dialog = screen.getByRole("dialog", { name: "编辑分析用例" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "期望根因或结论" }), { target: { value: "温度超出阈值" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存用例" }));
    await waitFor(() => expect(repository.updateAnalysisCase).toHaveBeenCalledWith("skill", "case", expect.objectContaining({ expectations: expect.objectContaining({ rootCausePoints: ["温度超出阈值"] }) })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "草稿轨迹" }));
    expect(await screen.findByRole("dialog", { name: /分析轨迹/ })).toHaveTextContent("模型轮次");
    expect(repository.getAnalysisCaseTrace).toHaveBeenCalledWith("skill", "run", "case", "draft");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "运行" }));
    await screen.findByRole("progressbar", { name: "分析用例运行进度" });
    expect(repository.startAnalysisCaseRun).toHaveBeenCalledWith("skill", ["case"]);
    expect(beforeRun.mock.invocationCallOrder[0]).toBeLessThan(repository.startAnalysisCaseRun.mock.invocationCallOrder[0]);
    await waitFor(() => expect(screen.getByText("分析用例运行完成")).toBeInTheDocument(), { timeout: 2500 });
    fireEvent.click(screen.getByRole("button", { name: "运行全部用例" }));
    await waitFor(() => expect(repository.startAnalysisCaseRun).toHaveBeenLastCalledWith("skill", undefined));
  });

  it.each([false, true])("publish summary is current-only and advisory (dirty=%s)", async (dirty) => {
    const onRun = vi.fn();
    render(<AnalysisCasePublishSummary skillId="skill" draftId="draft" dirty={dirty}
      repository={{ listAnalysisCases: async () => ({ items: [item], latestRun: run, current: true }) }} onRun={onRun} />);
    if (dirty) { fireEvent.click(await screen.findByRole("button", { name: "运行分析用例" })); expect(onRun).toHaveBeenCalled();
      expect(screen.queryByText(/通过 1/)).not.toBeInTheDocument(); }
    else expect(await screen.findByText("分析用例：通过 1 / 1（较已发布 +1 / −0）")).toBeInTheDocument();
    expect(screen.getByText("测试结果仅供参考，不阻止发布。")).toBeInTheDocument();
  });

  it("offers no mutating actions to a viewer and shows the empty state", async () => {
    render(<AnalysisCasesSection skillId="skill" canEdit={false} repository={{ listAnalysisCases: async () => ({ items: [], latestRun: null, current: false }) }} beforeRun={async () => undefined} />);
    expect(await screen.findByText(/还没有分析用例/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加分析用例" })).not.toBeInTheDocument();
  });

  it("retains sibling last scores after a one-case run and opens the original trace", async () => {
    const sibling = { ...item, id: "sibling", name: "其他用例" };
    const getAnalysisCaseTrace = vi.fn(async () => []);
    render(<AnalysisCasesSection skillId="skill" canEdit beforeRun={async () => undefined} repository={{ getAnalysisCaseTrace,
      listAnalysisCases: async () => ({ items: [item, sibling], latestRun: run, current: true,
        lastResults: [{ runId: "older-run", result: { ...run.results[0], caseId: sibling.id, name: sibling.name } }] }) }} />);
    const table = await screen.findByRole("table", { name: "分析用例列表" });
    const row = within(table).getByText("其他用例").closest("tr")!;
    expect(row).toHaveTextContent("草稿 80 · 通过"); expect(row).toHaveTextContent("历史结果");
    fireEvent.click(within(row).getByRole("button", { name: "草稿轨迹" }));
    await waitFor(() => expect(getAnalysisCaseTrace).toHaveBeenCalledWith("skill", "older-run", "sibling", "draft"));
  });

  it("keeps publication available when the current analysis case fails", async () => {
    const skill = structuredClone(mockSkillWorkspace("skill-charging")!);
    skill.draft = { ...skill.currentRevision, id: "draft", number: 2, status: "draft" };
    const failedRun = { ...run, results: run.results.map((result) => ({ ...result, draft: { ...result.draft, passed: false } })) };
    const repository = { getLogSkill: async () => skill, listSkillRevisions: async () => [skill.draft!, skill.currentRevision],
      listAnalysisCases: async () => ({ items: [item], latestRun: failedRun, current: true }),
      publishSkill: vi.fn(async () => ({ ...skill, draft: null, currentRevision: { ...skill.draft!, status: "published" as const } })) };
    render(<SkillWorkspace skillId={skill.id} search="" apiMode canEdit repository={repository} onNavigate={vi.fn()} onPublished={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "发布" }));
    const dialog = screen.getByRole("dialog", { name: "发布技能" });
    expect(await within(dialog).findByText("分析用例：通过 0 / 1（较已发布 +1 / −0）")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "发布" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "发布" }));
    await waitFor(() => expect(repository.publishSkill).toHaveBeenCalledWith(skill.id, "draft"));
  });

  it("validates file anchors before saving an uploaded bundle", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<AnalysisCaseDialog initial={item} uploadRequired onSave={onSave} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText("原始日志包"), { target: { files: [new File(["original bytes"], "device.log")] } });
    fireEvent.change(screen.getByRole("textbox", { name: "关键证据（YAML）" }), { target: { value: "- {file: device.log, line: 0}" } });
    fireEvent.submit(screen.getByRole("button", { name: "保存用例" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("关键证据"); expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "关键证据（YAML）" }), { target: { value: "- {file: device.log, pattern: thermal}" } });
    fireEvent.submit(screen.getByRole("button", { name: "保存用例" }).closest("form")!);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.any(File)], expectations: expect.objectContaining({ keyEvidence: [{ file: "device.log", pattern: "thermal" }] }) })));
  });
});
