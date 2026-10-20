import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { LogsPage } from "@/features/log-analysis/LogsPage";
import { ToastProvider } from "@/components/common/toast/ToastProvider";
import { emptyCaseExpectations } from "@/features/log-skills/AnalysisCaseDialog";
import { initialState } from "./mockData";

afterEach(cleanup);
function setup({ admin = true, complete = true, bound = true } = {}) {
  const record = { ...initialState.logs.find((log) => log.status === "Complete")!, logDomainId: bound ? "skill" : undefined,
    status: complete ? "Complete" as const : "Processing" as const };
  const expectations = { ...emptyCaseExpectations, summary: "报告回归", rootCausePoints: [record.conclusion], keyEvidence: [{ file: "device.log", line: 2 }], expectedActions: ["检查散热"] };
  const repository = { getLog: vi.fn(async () => record), getAnalysisCasePrefill: vi.fn(async () => ({ skillId: "skill", name: "报告回归", expectations,
    originalUploads: [{ fileName: "original.zip", sizeBytes: 2048 }],
    files: [{ path: "device.log", sizeBytes: 4096, lineCount: 10, encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null }],
    sourceDegradation: { reason: "provider-unavailable" } })),
    createAnalysisCase: vi.fn(async () => ({ id: "case" })) };
  render(<ToastProvider><LogsPage state={{ ...initialState, logs: [record] }} dispatch={vi.fn()} onNavigate={vi.fn()} search=""
    sessionPermissions={admin ? ["logs:admin-domains"] : ["logs:view"]}
    runtime={{ logAnalysisRepository: repository } as unknown as NonNullable<Parameters<typeof LogsPage>[0]["runtime"]>} /></ToastProvider>);
  return { repository, record, expectations };
}

describe("report save as analysis case", () => {
  it("loads original-bundle prefill, lets the administrator edit, and saves the source record reference", async () => {
    const { repository, record } = setup();
    await userEvent.click(screen.getByRole("button", { name: "更多" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "存为分析用例" }));
    const dialog = await screen.findByRole("dialog", { name: "存为分析用例" });
    expect(within(dialog).getByRole("textbox", { name: "期望根因或结论" })).toHaveValue(record.conclusion);
    expect(within(dialog).getByRole("combobox", { name: "证据 1 文件" })).toHaveAttribute("data-value", "device.log");
    expect(within(dialog).getByRole("spinbutton", { name: "证据 1 行号" })).toHaveValue(2);
    expect(dialog).toHaveTextContent("original.zip · 2.0 KB"); expect(dialog).toHaveTextContent("此次降级不会自动设为用例期望");
    expect(dialog).toHaveTextContent("该报告由规则回退生成，期望内容请人工核对。");
    expect(within(dialog).getByRole("textbox", { name: "期望建议动作" })).toHaveValue("检查散热");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "期望根因或结论" }), { target: { value: "确认后的根因" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存用例" }));
    await waitFor(() => expect(repository.createAnalysisCase).toHaveBeenCalledWith("skill", expect.objectContaining({ sourceRecordId: record.id,
      expectations: expect.objectContaining({ rootCausePoints: ["确认后的根因"], keyEvidence: [{ file: "device.log", line: 2 }], expectedActions: ["检查散热"] }) })));
    expect(repository.getAnalysisCasePrefill).toHaveBeenCalledWith(record.id);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it.each([{ admin: false }, { complete: false }, { bound: false }])("hides the action outside admin/completed/skill scope: %j", async (options) => {
    setup(options);
    const more = screen.queryByRole("button", { name: "更多" });
    if (more) await userEvent.click(more);
    expect(screen.queryByRole("menuitem", { name: "存为分析用例" })).not.toBeInTheDocument();
  });
});
