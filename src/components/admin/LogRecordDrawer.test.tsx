import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogRecord } from "@/domain/prototype/types";
import { LogRecordDrawer } from "./LogRecordDrawer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const record: LogRecord = {
  id: "log-active",
  reportId: "RPT-9092",
  fileName: "charging_thermal_trace_20260504.log",
  source: "Battery Thermal",
  fileSizeMB: 48.2,
  status: "Processing",
  stage: "rootcause",
  confidence: 85,
  conclusion: "快充阶段电池包温升过快。",
  impact: "battery-pack-lab-a",
  evidence: [
    {
      id: "ev-1",
      stageId: "parse",
      lineNumbers: [20],
      inference: "10:24:01 WARN battery temperature over soft limit",
      suggestedAction: "复核温控阈值",
      ruleHit: "thermal_soft_limit"
    },
    {
      id: "ev-2",
      stageId: "rootcause",
      lineNumbers: [30],
      inference: "10:24:03 INFO policy foldback engaged",
      suggestedAction: "下调快充电流"
    }
  ],
  suggestedActions: ["下调快充电流", "复核温控阈值"],
  severity: "Warning",
  rawLines: [],
  capturedAt: "10:24:05",
  updatedAt: "18 分钟前",
  updatedAtIso: new Date().toISOString(),
  submittedBy: "H. Zhao"
};

describe("LogRecordDrawer", () => {
  it("shows enum labels and typed decoded chips under the evidence anchor", () => {
    const evidence = { ...record.evidence[0], filePath: "device.log", decodedFields: [{ v: 1 as const, source: "declarative" as const, file: "device.log", line: 20, extractor: "state", fields: { state: { raw: "2", value: "thermal" }, current: { raw: "0x10", value: 16 } } }] };
    render(<LogRecordDrawer record={{ ...record, evidence: [evidence] }} open onClose={vi.fn()} onNavigateToWorkbench={vi.fn()} onReanalyze={vi.fn()} onArchive={vi.fn()} onSubmitHelpfulFeedback={vi.fn()} canAct />);
    const chips = screen.getByLabelText("解码字段");
    expect(chips).toHaveTextContent("state = thermal");
    expect(chips).toHaveTextContent("current = 16");
    expect(screen.getByText("device.log:20").closest("li")).toContainElement(chips);
  });
  const handlers = {
    onClose: vi.fn(),
    onNavigateToWorkbench: vi.fn(),
    onReanalyze: vi.fn(),
    onArchive: vi.fn(),
    onSubmitHelpfulFeedback: vi.fn()
  };

  it("loads detail only when opened and shows loading instead of a false zero evidence count", async () => {
    let resolve!: (value: LogRecord) => void;
    const loading = new Promise<LogRecord>((done) => { resolve = done; });
    const loadRecord = vi.fn().mockReturnValue(loading);
    const summary = { ...record, evidence: [] };
    const view = render(<LogRecordDrawer record={summary} open={false} loadRecord={loadRecord} {...handlers} canAct />);
    expect(loadRecord).not.toHaveBeenCalled();
    view.rerender(<LogRecordDrawer record={summary} open loadRecord={loadRecord} {...handlers} canAct />);
    expect(loadRecord).toHaveBeenCalledExactlyOnceWith(record.id);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载详情…");
    expect(screen.queryByText("证据链（0）")).not.toBeInTheDocument();
    const evidence = Array.from({ length: 6 }, (_, index) => ({ ...record.evidence[0], id: `detail-${index}`, inference: `详情证据 ${index + 1}` }));
    await act(async () => { resolve({ ...record, evidence }); });
    expect(await screen.findByText("证据链（6）")).toBeInTheDocument();
    for (const item of evidence) expect(screen.getByText(item.inference)).toBeInTheDocument();
    expect(screen.queryByText("正在加载详情…")).not.toBeInTheDocument();
  });

  it.each(["failed", "missing"])("offers an inline retry when record detail is %s", async (outcome) => {
    const loadRecord = vi.fn();
    if (outcome === "failed") loadRecord.mockRejectedValueOnce(new Error("offline"));
    else loadRecord.mockResolvedValueOnce(null);
    loadRecord.mockResolvedValueOnce(record);
    render(<LogRecordDrawer record={{ ...record, evidence: [] }} open loadRecord={loadRecord} {...handlers} canAct />);
    expect(await screen.findByRole("alert")).toHaveTextContent("无法加载详情，请重试。");
    expect(screen.queryByText("证据链（0）")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("证据链（2）")).toBeInTheDocument();
    expect(loadRecord).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  });

  it("ignores an old detail response when switching to a different record", async () => {
    let resolve!: (value: LogRecord) => void;
    const loading = new Promise<LogRecord>((done) => { resolve = done; });
    const next = { ...record, id: "log-next", fileName: "next.log", conclusion: "新记录结论" };
    const loadRecord = vi.fn().mockReturnValueOnce(loading).mockResolvedValueOnce(next);
    const view = render(<LogRecordDrawer record={record} open loadRecord={loadRecord} {...handlers} canAct />);
    view.rerender(<LogRecordDrawer record={{ ...next, evidence: [] }} open loadRecord={loadRecord} {...handlers} canAct />);
    expect(await screen.findByText("证据链（2）")).toBeInTheDocument();
    await act(async () => { resolve({ ...record, evidence: [] }); });
    expect(screen.getByText("新记录结论")).toBeInTheDocument();
    expect(screen.getByText("证据链（2）")).toBeInTheDocument();
    expect(screen.queryByText("证据链（0）")).not.toBeInTheDocument();
    expect(loadRecord.mock.calls).toEqual([[record.id], [next.id]]);
  });

  it("shows the file path alongside evidence line numbers", () => {
    render(<LogRecordDrawer record={{ ...record, evidence: [{ ...record.evidence[0], filePath: "device/kernel.log", lineNumbers: [20] }] }} open {...handlers} canAct />);
    expect(screen.getByText("device/kernel.log:20")).toBeInTheDocument();
  });

  it("renders nothing when record is null", () => {
    render(<LogRecordDrawer record={null} open={false} {...handlers} canAct />);

    expect(screen.queryByText(/RPT-/)).not.toBeInTheDocument();
  });

  it("renders record fields when open", () => {
    render(<LogRecordDrawer record={record} open {...handlers} canAct />);

    expect(screen.getByText("报告 ID：RPT-9092")).toBeInTheDocument();
    expect(screen.getByText(/charging_thermal_trace/)).toBeInTheDocument();
    expect(screen.getByText(record.conclusion)).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  it("lists evidence items", () => {
    render(<LogRecordDrawer record={record} open {...handlers} canAct />);

    expect(screen.getAllByText(/10:24:01 WARN/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10:24:03 INFO/).length).toBeGreaterThan(0);
    expect(screen.getByText("L20")).toBeInTheDocument();
  });

  it("lists suggested actions", () => {
    render(<LogRecordDrawer record={record} open {...handlers} canAct />);

    expect(screen.getAllByText("下调快充电流").length).toBeGreaterThan(0);
    expect(screen.getAllByText("复核温控阈值").length).toBeGreaterThan(0);
  });

  it("disables action buttons when canAct=false", () => {
    render(<LogRecordDrawer record={record} open {...handlers} canAct={false} />);

    expect(screen.getByRole("button", { name: /重新分析/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /归档/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /有帮助/ })).toBeDisabled();
  });

  it("calls onNavigateToWorkbench on 跳转", async () => {
    const onNavigateToWorkbench = vi.fn();
    render(
      <LogRecordDrawer
        record={record}
        open
        onClose={vi.fn()}
        onNavigateToWorkbench={onNavigateToWorkbench}
        onReanalyze={vi.fn()}
        onArchive={vi.fn()}
        canAct
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /打开报告/ }));
    expect(onNavigateToWorkbench).toHaveBeenCalledWith("log-active");
  });

  it("calls onReanalyze on 重新分析", async () => {
    const onReanalyze = vi.fn();
    render(
      <LogRecordDrawer
        record={record}
        open
        onClose={vi.fn()}
        onNavigateToWorkbench={vi.fn()}
        onReanalyze={onReanalyze}
        onArchive={vi.fn()}
        canAct
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /重新分析/ }));
    expect(onReanalyze).toHaveBeenCalledWith("log-active");
  });

  it("calls onArchive on 归档", async () => {
    const onArchive = vi.fn();
    render(
      <LogRecordDrawer
        record={record}
        open
        onClose={vi.fn()}
        onNavigateToWorkbench={vi.fn()}
        onReanalyze={vi.fn()}
        onArchive={onArchive}
        canAct
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /归档/ }));
    expect(onArchive).toHaveBeenCalledWith("log-active");
  });

  it("calls onSubmitHelpfulFeedback on 有帮助", async () => {
    const onSubmitHelpfulFeedback = vi.fn();
    render(
      <LogRecordDrawer
        record={record}
        open
        onClose={vi.fn()}
        onNavigateToWorkbench={vi.fn()}
        onReanalyze={vi.fn()}
        onArchive={vi.fn()}
        onSubmitHelpfulFeedback={onSubmitHelpfulFeedback}
        canAct
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /有帮助/ }));
    expect(onSubmitHelpfulFeedback).toHaveBeenCalledWith("log-active");
  });

  it("marks pending action buttons busy", () => {
    render(<LogRecordDrawer record={record} open {...handlers} canAct reanalyzePending archivePending feedbackPending />);

    expect(screen.getByRole("button", { name: /重新分析/ })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: /归档/ })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: /有帮助/ })).toHaveAttribute("aria-busy", "true");
  });

  it("marks degraded rules-fallback results prominently with the reason", () => {
    render(
      <LogRecordDrawer
        record={{
          ...record,
          analysisSource: "rules-fallback",
          degradedReason: "provider-unavailable",
          logDomainName: "charging-power",
          skillRevision: { id: "revision-3", number: 3 }
        }}
        open
        {...handlers}
        canAct
      />
    );

    const provenance = screen.getByTestId("drawer-analysis-provenance");
    expect(provenance).toHaveTextContent("降级分析 · 规则回退");
    expect(provenance).toHaveTextContent(/AI 分析服务不可用/);
    expect(provenance).toHaveTextContent("技能 charging-power · v3");
    expect(screen.getByText("置信度")).toBeInTheDocument();
    expect(screen.getByText("规则回退")).toBeInTheDocument();
    expect(screen.queryByText("规则评分")).not.toBeInTheDocument();
    expect(screen.queryByText("模型自估")).not.toBeInTheDocument();
  });

  it("shows confidence with a small agent source chip without a degraded warning", () => {
    render(<LogRecordDrawer record={{ ...record, analysisSource: "agent" }} open {...handlers} canAct />);

    const source = screen.getByText("AI 分析");
    expect(source).toHaveClass("border", "text-muted-foreground");
    expect(source.parentElement).toContainElement(screen.getByText("置信度"));
    expect(screen.queryByTestId("drawer-analysis-provenance")).not.toBeInTheDocument();
    expect(screen.queryByText("模型自估")).not.toBeInTheDocument();
  });

  it("renders no provenance block for legacy records without a source", () => {
    render(<LogRecordDrawer record={record} open {...handlers} canAct />);

    expect(screen.queryByTestId("drawer-analysis-provenance")).not.toBeInTheDocument();
    expect(screen.getByText("置信度")).toBeInTheDocument();
    expect(screen.queryByText("模型自估")).not.toBeInTheDocument();
    expect(screen.queryByText("规则评分")).not.toBeInTheDocument();
  });

  it("marks an early-converged agent conclusion as degraded instead of a full analysis", () => {
    render(
      <LogRecordDrawer
        record={{ ...record, analysisSource: "agent", degradedReason: "token-budget-exhausted" }}
        open
        {...handlers}
        canAct
      />
    );

    const provenance = screen.getByTestId("drawer-analysis-provenance");
    expect(provenance).toHaveTextContent("降级分析 · 提前收敛");
    expect(provenance).toHaveTextContent(/提前收敛为低置信结论/);
    expect(provenance).not.toHaveTextContent("降级分析 · 规则回退");
    expect(screen.getByText("置信度")).toBeInTheDocument();
    expect(screen.getByText("AI 分析")).toBeInTheDocument();
  });

  it("counts and lists all six evidence items", () => {
    const evidence = Array.from({ length: 6 }, (_, index) => ({ ...record.evidence[0], id: `evidence-${index}`, inference: `证据内容 ${index + 1}` }));
    render(<LogRecordDrawer record={{ ...record, evidence }} open {...handlers} canAct />);
    expect(screen.getByText("证据链（6）")).toBeInTheDocument();
    for (const item of evidence) expect(screen.getByText(item.inference)).toBeInTheDocument();
  });

  it("separates evidence blocks with a stage chip, inference, locations and a labelled suggestion in order", () => {
    const evidence = [record.evidence[1], { ...record.evidence[0], stageId: "pattern" as const }];
    render(<LogRecordDrawer record={{ ...record, evidence }} open {...handlers} canAct />);
    const items = within(screen.getByRole("list", { name: "证据条目" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    for (const [index, item] of items.entries()) {
      expect(item).toHaveClass("flex-col", "gap-2", "py-3", "border-t", "border-border", "first:border-t-0");
      const chip = item.children[0];
      expect(chip).toHaveTextContent(index === 0 ? "根因推断" : "模式匹配");
      expect(chip).toHaveClass("rounded-md", "border", "border-border");
      expect(item.children[1]).toHaveTextContent(evidence[index].inference);
      expect(item.children[2]).toHaveTextContent(`L${evidence[index].lineNumbers[0]}`);
      expect(item.lastElementChild).toHaveTextContent(`建议：${evidence[index].suggestedAction}`);
    }
  });

  it.each([0, 3, 4, 216])("caps each evidence item at three locations out of %s, with the rest counted as plain text", (count) => {
    const lineNumbers = Array.from({ length: count }, (_, index) => index + 1);
    const evidence = [
      { ...record.evidence[0], id: "file-evidence", filePath: "device.log", lineNumbers, inference: "带文件路径的证据结论" },
      { ...record.evidence[0], id: "line-evidence", lineNumbers, inference: "仅有行号的证据结论" }
    ];
    render(<LogRecordDrawer record={{ ...record, evidence }} open {...handlers} canAct />);
    const items = within(screen.getByRole("list", { name: "证据条目" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    for (const [index, item] of items.entries()) {
      expect(within(item).getByText(evidence[index].inference)).toBeInTheDocument();
      const locations = within(item).queryAllByText(/^(device\.log:|L)\d+$/);
      expect(locations).toHaveLength(Math.min(3, count));
      expect(locations.map((location) => location.textContent)).toEqual(lineNumbers.slice(0, 3).map((line) => index === 0 ? `device.log:${line}` : `L${line}`));
      expect(within(item).queryByText(index === 0 ? "device.log:4" : "L4")).not.toBeInTheDocument();
      if (count > 3) {
        const remainder = within(item).getByText(`其余 ${count - 3} 行`);
        expect(remainder.closest("a, button")).toBeNull();
      } else expect(within(item).queryByText(/^其余/)).not.toBeInTheDocument();
    }
  });

  it.each([[20 * 1024, "20.0 KB"], [20, "20 B"], [2 * 1024 ** 2, "2.0 MB"]])("uses precise file-inventory bytes for adaptive sizes: %s", (sizeBytes, label) => {
    render(<LogRecordDrawer record={{ ...record, fileSizeMB: 0, source: "upload", files: [{ path: "device.log", sizeBytes, lineCount: 1, encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null }] }} open {...handlers} canAct />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText("upload")).not.toBeInTheDocument();
  });

  it("uses adaptive sizes for legacy records without a file inventory", () => {
    render(<LogRecordDrawer record={{ ...record, fileSizeMB: 20 / 1024 }} open {...handlers} canAct />);
    expect(screen.getByText("20.0 KB")).toBeInTheDocument();
  });

  it.each(["Processing", "Complete"] as const)("keeps draft export disabled without completed raw log data (%s)", async (status) => {
    render(<LogRecordDrawer record={{ ...record, status, rawLines: [] }} open {...handlers} canAct />);
    await userEvent.click(screen.getByRole("button", { name: `${record.fileName}：更多` }));
    expect(screen.getByRole("menuitem", { name: "导出分析用例草稿" })).toHaveAttribute("aria-disabled", "true");
  });

  it("exports the golden-case draft and raw log with the full de-identification checklist from the drawer menu", async () => {
    const complete = { ...record, status: "Complete" as const, logDomainId: undefined, logDomainName: undefined,
      analysisQuestion: "为什么快充降速？", rawLines: ["20 WARN temperature", "30 INFO foldback"] };
    const blobs: Blob[] = [];
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return `blob:export-${blobs.length}`; }), revokeObjectURL }));
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    render(<LogRecordDrawer record={{ ...complete, rawLines: [], evidence: [] }} loadRecord={vi.fn().mockResolvedValue(complete)} open {...handlers} canAct />);
    await screen.findByText("证据链（2）");
    expect(screen.queryByRole("button", { name: "存为分析用例" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: `${record.fileName}：更多` }));
    await userEvent.click(screen.getByRole("menuitem", { name: "导出分析用例草稿" }));
    const dialog = await screen.findByRole("dialog", { name: "导出分析用例草稿" });
    expect(within(dialog).getByTestId("export-eval-case-draft-dialog")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("eval-cases/logs/uncategorized/");
    for (const text of ["无个人姓名、电话、邮箱或账号标识", "无客户/公司名称、项目代号或合同标识", "无设备序列号、MAC、IMEI 或精确地理位置", "无可识别客户网络的 IP/主机名", "无凭据、令牌或内部 URL", "替换保持行号与技术语义稳定", "领域专家在脱敏后确认标注内容", "把 deIdentified 改为 true", "无法完全脱敏的案例不得进入仓库"])
      expect(dialog).toHaveTextContent(text);
    await userEvent.click(within(dialog).getByRole("button", { name: "下载 case.yaml 草稿" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "下载 log.txt" }));
    expect(blobs).toHaveLength(2);
    const texts = await Promise.all(blobs.map((blob) => new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); })));
    expect(names[0]).toMatch(/case\.yaml$/);
    expect(names[1]).toMatch(/log\.txt$/);
    for (const text of ["domain: uncategorized", "realLog: true", "deIdentified: false", "rootCauseCategory: TODO", "keyEvidenceLines: [20, 30]", 'analysisQuestion: "为什么快充降速？"']) expect(texts[0]).toContain(text);
    expect(texts[1]).toBe("20 WARN temperature\n30 INFO foldback\n");
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    await userEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    expect(await screen.findByRole("button", { name: "打开报告" })).toBeVisible();
  });

  describe("存为分析用例", () => {
    const completedRecord = { ...record, status: "Complete" as const, logDomainId: "skill-charging" };
    const prefill = { skillId: "skill-charging", name: "快充分析用例", files: [{ path: "device.log", sizeBytes: 20, lineCount: 1, encoding: "utf-8" as const, lossy: false, status: "analyzed" as const, skipReason: null }],
      expectations: { domain: "charging", summary: "温控", realLog: false, rootCauseCategory: "thermal-protection" as const,
        rootCausePoints: ["温控触发"], keyEvidenceLines: [1], expectedActions: ["检查温度"], expectRefusal: false } };

    it("hides saving for general analysis and explains disabled skill-record actions inline", () => {
      const repository = { getAnalysisCasePrefill: vi.fn(), createAnalysisCase: vi.fn() };
      const view = render(<LogRecordDrawer record={record} open {...handlers} canAct skillRepository={repository} />);
      expect(screen.queryByRole("button", { name: "存为分析用例" })).not.toBeInTheDocument();
      expect(screen.queryByText("分析用例服务暂不可用。")).not.toBeInTheDocument();
      view.rerender(<LogRecordDrawer record={{ ...record, logDomainId: completedRecord.logDomainId }} open {...handlers} canAct skillRepository={repository} />);
      expect(screen.getByRole("button", { name: "存为分析用例" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "存为分析用例" })).toHaveAccessibleDescription("分析完成后可保存为分析用例。");
      expect(screen.getByText("分析完成后可保存为分析用例。")).toBeVisible();
      view.rerender(<LogRecordDrawer record={completedRecord} open {...handlers} canAct={false} skillRepository={repository} />);
      expect(screen.getByRole("button", { name: "存为分析用例" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "存为分析用例" })).toHaveAccessibleDescription("需要管理员权限才能保存分析用例。");
      expect(screen.getByText("需要管理员权限才能保存分析用例。")).toBeVisible();
      view.rerender(<LogRecordDrawer record={completedRecord} open {...handlers} canAct />);
      expect(screen.getByRole("button", { name: "存为分析用例" })).toBeDisabled();
      expect(screen.getByText("分析用例服务暂不可用。")).toBeVisible();
      view.rerender(<LogRecordDrawer record={{ ...completedRecord, logDomainId: undefined }} open {...handlers} canAct skillRepository={repository} />);
      expect(screen.queryByRole("button", { name: "存为分析用例" })).not.toBeInTheDocument();
      expect(repository.getAnalysisCasePrefill).not.toHaveBeenCalled();
    });

    it("uses the report-page dialog and saves the source record through the same repository flow", async () => {
      const repository = { getAnalysisCasePrefill: vi.fn().mockResolvedValue(prefill), createAnalysisCase: vi.fn().mockResolvedValue({}) };
      render(<LogRecordDrawer record={completedRecord} open {...handlers} canAct skillRepository={repository} />);
      await userEvent.click(screen.getByRole("button", { name: "存为分析用例" }));
      const dialog = await screen.findByRole("dialog", { name: "存为分析用例" });
      expect(repository.getAnalysisCasePrefill).toHaveBeenCalledWith(completedRecord.id);
      expect(within(dialog).getByLabelText("用例名称")).toHaveValue(prefill.name);
      await userEvent.click(within(dialog).getByRole("button", { name: "保存用例" }));
      expect(repository.createAnalysisCase).toHaveBeenCalledWith(prefill.skillId, expect.objectContaining({ name: prefill.name, sourceRecordId: completedRecord.id }));
    });

    it("explains the disabled action while loading the analysis case", async () => {
      let resolve!: (value: typeof prefill) => void;
      const loading = new Promise<typeof prefill>((done) => { resolve = done; });
      const repository = { getAnalysisCasePrefill: vi.fn().mockReturnValue(loading), createAnalysisCase: vi.fn() };
      render(<LogRecordDrawer record={completedRecord} open {...handlers} canAct skillRepository={repository} />);
      await userEvent.click(screen.getByRole("button", { name: "存为分析用例" }));
      expect(screen.getByRole("button", { name: "存为分析用例" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "存为分析用例" })).toHaveAccessibleDescription("正在加载分析用例…");
      expect(screen.getByText("正在加载分析用例…")).toBeVisible();
      await act(async () => { resolve(prefill); });
      expect(await screen.findByRole("dialog", { name: "存为分析用例" })).toBeInTheDocument();
    });

    it("shows a readable error and permits retry when prefill fails", async () => {
      const repository = { getAnalysisCasePrefill: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(prefill), createAnalysisCase: vi.fn() };
      render(<LogRecordDrawer record={completedRecord} open {...handlers} canAct skillRepository={repository} />);
      await userEvent.click(screen.getByRole("button", { name: "存为分析用例" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("无法加载分析用例，请重试。");
      await userEvent.click(screen.getByRole("button", { name: "存为分析用例" }));
      expect(await screen.findByRole("dialog", { name: "存为分析用例" })).toBeInTheDocument();
    });
  });
});
