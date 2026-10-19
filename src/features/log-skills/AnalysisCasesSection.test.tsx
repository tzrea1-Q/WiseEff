import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { AnalysisCasesSection, AnalysisCasePublishSummary } from "./AnalysisCasesSection";
import { AnalysisCaseDialog, emptyCaseExpectations, presentAnalysisCaseError } from "./AnalysisCaseDialog";
import { SkillWorkspace } from "./SkillWorkspace";
import { mockSkillWorkspace } from "@/infrastructure/mock/logSkills";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { AnalysisCase, AnalysisCaseRun } from "./types";

afterEach(cleanup);
const item: AnalysisCase = { id: "case", name: "热保护", expectations: { ...emptyCaseExpectations, summary: "热保护", rootCausePoints: ["温度过高"],
  keyEvidence: [{ file: "device.log", line: 2 }], expectedActions: ["检查散热"] }, files: [{ path: "device.log", sizeBytes: 40, lineCount: 2,
  encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null }], createdAt: "2026-10-19", updatedAt: "2026-10-19" };
const report = { confidence: 0.9, conclusion: "温度过高", impact: "限流", severity: "Warning" as const, suggestedActions: ["检查散热"],
  evidence: [], reportContext: { lineCount: 2, entryCount: 2 } };
const quality = { evidence: { precision: 1, recall: 1, hitLines: [2], missedLines: [], extraLines: [] },
  anchorEvidence: { precision: 0.5, recall: 0.5, hits: [{ file: "device.log", line: 2 }], misses: [{ file: "device.log", pattern: "timeout" }],
    hallucinatedLines: [{ file: "missing.log", line: 3 }], hallucinationRate: 0.5 },
  judge: { rootCauseScore: 0.8, actionsScore: 0.75, categoryMatch: false }, refusal: { expected: false, refused: false, appropriate: true },
  hallucination: { rate: 0, citedNonexistentLines: [] } };
const run: AnalysisCaseRun = { id: "run", skillRevisionId: "draft", publishedRevisionId: "published", status: "complete", progress: 100,
  results: [{ caseId: "case", name: "热保护", draft: { score: 80, passed: true, report, quality, traceReference: "trace-draft" },
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
    expect(table).toHaveTextContent("草稿 80% · 通过 · 未降级"); expect(table).toHaveTextContent("已发布 60% · 未通过"); expect(table).toHaveTextContent("变化 +20 个百分点");
    await userEvent.click(screen.getByRole("button", { name: /更多/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    const dialog = screen.getByRole("dialog", { name: "编辑分析用例" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "期望根因或结论" }), { target: { value: "温度超出阈值" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存用例" }));
    await waitFor(() => expect(repository.updateAnalysisCase).toHaveBeenCalledWith("skill", "case", expect.objectContaining({ expectations: expect.objectContaining({ rootCausePoints: ["温度超出阈值"] }) })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "查看结果" }));
    const resultDialog = screen.getByRole("dialog", { name: /用例结果/ });
    expect(resultDialog).toHaveTextContent("50% / 50%"); expect(resultDialog).toHaveTextContent("device.log:timeout");
    expect(resultDialog).toHaveTextContent("50%；不存在的文件或行：missing.log:3");
    expect(resultDialog).toHaveTextContent("80% / 75%"); expect(resultDialog).toHaveTextContent("不匹配");
    expect(screen.queryByText("模型轮次")).not.toBeInTheDocument();
    fireEvent.click(within(resultDialog).getByText("草稿分析轨迹"));
    fireEvent.click(within(screen.getByRole("region", { name: "草稿评分详情" })).getByRole("button", { name: "加载轨迹" }));
    expect(await screen.findByText(/模型轮次/)).toBeInTheDocument();
    expect(repository.getAnalysisCaseTrace).toHaveBeenCalledWith("skill", "run", "case", "draft");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await userEvent.click(screen.getByRole("button", { name: /更多/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "运行" }));
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
    expect(row).toHaveTextContent("草稿 80% · 通过"); expect(row).toHaveTextContent("历史结果");
    fireEvent.click(within(row).getByRole("button", { name: "查看结果" }));
    fireEvent.click(screen.getByText("草稿分析轨迹"));
    fireEvent.click(within(screen.getByRole("region", { name: "草稿评分详情" })).getByRole("button", { name: "加载轨迹" }));
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
    render(<AnalysisCaseDialog initial={item} uploadRequired availableFiles={item.files} onSave={onSave} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText("原始日志包"), { target: { files: [new File(["original bytes"], "device.log")] } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "证据 1 行号" }), { target: { value: "0" } });
    fireEvent.submit(screen.getByRole("button", { name: "保存用例" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("请修正标出的字段"); expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("spinbutton", { name: "证据 1 行号" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("请输入 1 至 2 之间的行号。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "模式" }));
    fireEvent.change(screen.getByRole("textbox", { name: "证据 1 匹配模式" }), { target: { value: "thermal" } });
    fireEvent.submit(screen.getByRole("button", { name: "保存用例" }).closest("form")!);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.any(File)], expectations: expect.objectContaining({ keyEvidence: [{ file: "device.log", pattern: "thermal" }] }) })));
  });

  it("renders a literal 1% score, degradation, and unavailable historical file-aware metrics honestly", async () => {
    const legacyQuality = { ...quality, anchorEvidence: undefined };
    const low = { ...run, results: [{ ...run.results[0], draft: { ...run.results[0].draft, score: 1, quality: legacyQuality,
      report: { ...report, analysisSource: "rules-fallback" as const, degradedReason: "provider-unavailable" as const } } }] };
    render(<AnalysisCasesSection skillId="skill" canEdit={false} beforeRun={async () => undefined}
      repository={{ listAnalysisCases: async () => ({ items: [item], latestRun: low, current: true }) }} />);
    expect(await screen.findByRole("table")).toHaveTextContent("草稿 1% · 通过 · 已降级：模型服务不可用，规则回退");
    fireEvent.click(screen.getByRole("button", { name: "查看结果" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("文件证据评分未保存，请重新运行。");
    expect(screen.getByRole("region", { name: "草稿评分详情" })).not.toHaveTextContent("100% / 100%");
  });

  it("uses an outline import trigger and reports the chosen archive status", async () => {
    const importAnalysisCases = vi.fn(async () => undefined);
    render(<AnalysisCasesSection skillId="skill" canEdit beforeRun={async () => undefined}
      repository={{ importAnalysisCases, listAnalysisCases: async () => ({ items: [item], latestRun: run, current: true }) }} />);
    expect(await screen.findByRole("button", { name: "导入用例" })).toBeEnabled();
    const input = screen.getByLabelText("导入分析用例 ZIP"); expect(input).toHaveAttribute("hidden");
    const file = new File(["zip"], "regressions.zip"); fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText("已导入 regressions.zip")).toBeInTheDocument();
    expect(importAnalysisCases).toHaveBeenCalledWith("skill", file);
  });

  it("shows required field errors instead of a disabled save button", async () => {
    render(<AnalysisCaseDialog initial={{ name: "", expectations: emptyCaseExpectations }} uploadRequired onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "保存用例" }));
    expect(screen.getByRole("textbox", { name: "用例名称" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("请输入用例名称。")).toBeInTheDocument();
    expect(screen.getByText("请选择原始日志文件或压缩包。")).toBeInTheDocument();
    expect(screen.getByText("请至少添加一条关键证据。")).toBeInTheDocument();
  });

  it("maps a server field path to a specific accessible Chinese error", async () => {
    const onSave = vi.fn(async () => { throw new WiseEffApiError("VALIDATION_FAILED", "Invalid input", { issues: [{ path: ["expectations", "keyEvidence", 0, "line"], message: "Too big" }] }, "request"); });
    render(<AnalysisCaseDialog initial={item} availableFiles={item.files} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "保存用例" }));
    const line = screen.getByRole("spinbutton", { name: "证据 1 行号" });
    await waitFor(() => expect(line).toHaveAttribute("aria-invalid", "true"));
    expect(line).toHaveAccessibleDescription("证据行号无效，请检查文件是否存在该行。");
    expect(screen.queryByText("Too big")).not.toBeInTheDocument();
  });

  it("preserves and maps validation messages when the server provides no issues", async () => {
    const message = "Non-refusal cases require rootCausePoints, keyEvidenceLines or keyEvidence, and expectedActions.";
    const onSave = vi.fn(async () => { throw new WiseEffApiError("VALIDATION_FAILED", message, {}, "request"); });
    render(<AnalysisCaseDialog initial={item} availableFiles={item.files} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "保存用例" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "期望根因或结论" })).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByRole("textbox", { name: "期望根因或结论" })).toHaveAccessibleDescription("非拒答用例必须填写期望根因、关键证据和建议动作。");
    expect(screen.getByRole("group", { name: "关键证据" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("非拒答用例必须填写期望根因、关键证据和建议动作。");
    expect(presentAnalysisCaseError(new WiseEffApiError("VALIDATION_FAILED", "Specific new server validation", {}, "request"), "保存失败")).toBe("Specific new server validation");
  });

  it("preserves legacy line anchors when the file-aware anchor list is empty", () => {
    render(<AnalysisCaseDialog initial={{ ...item, expectations: { ...item.expectations, keyEvidence: [], keyEvidenceLines: [2] } }}
      availableFiles={item.files} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("spinbutton", { name: "证据 1 行号" })).toHaveValue(2);
  });

  it("offers manual internal paths for uploaded archives rather than the archive filename", async () => {
    render(<AnalysisCaseDialog initial={{ name: "归档用例", expectations: emptyCaseExpectations }} uploadRequired onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("原始日志包"), { target: { files: [new File(["archive"], "pack.zip")] } });
    fireEvent.click(screen.getByRole("button", { name: "添加证据" }));
    expect(screen.getByRole("textbox", { name: "证据 1 文件路径" })).toHaveValue("");
    expect(screen.getByText(/请填写包内文件的相对路径/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "证据 1 文件" })).not.toHaveAttribute("data-value", "pack.zip");
  });
});
