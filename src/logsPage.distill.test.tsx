import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";

import App from "./App";
import { ToastProvider } from "@/components/common/toast/ToastProvider";
import { LogsPage } from "@/features/log-analysis/LogsPage";
import { createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";
import { initialState } from "./mockData";

const userState = { ...initialState, activeRoleId: "user" };

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function renderLogsPage() {
  window.history.replaceState(null, "", "/logs");
  render(<App initialAppState={userState} />);
}

function selectCompleteLog() {
  const history = screen.getByRole("complementary", { name: "历史日志记录" });
  fireEvent.click(within(history).getByRole("button", { name: /usb_pd_negotiation/ }));
}

describe("LogsPage · 沉淀为知识", () => {
  it("Complete 日志从报告沉淀后交接到 /knowledge 草稿详情(预填结论标题与来源关联)", async () => {
    renderLogsPage();
    selectCompleteLog();
    expect(screen.getByRole("tab", { name: "报告", selected: true })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "更多" }));
    const distil = await screen.findByRole("menuitem", { name: "沉淀为知识" });
    expect(distil).not.toHaveAttribute("aria-disabled", "true");
    await user.click(distil);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/knowledge");
    });
    expect(window.location.search).toContain("entryId=");

    // The deep link opens the pre-filled draft in the entry detail dialog.
    const detail = await screen.findByRole("dialog", { name: /PD 协商在 9V\/3A 档位稳定完成/ });
    expect(within(detail).getByText("草稿")).toBeInTheDocument();
    expect(within(detail).getByText("日志分析")).toBeInTheDocument();
    expect(within(detail).getByText(/由日志分析记录沉淀/)).toBeInTheDocument();
  });

  it("Processing 日志不显示报告操作", () => {
    renderLogsPage();

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /charging_thermal_trace/ }));

    expect(screen.queryByRole("button", { name: "更多" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /沉淀为知识/ })).not.toBeInTheDocument();
  });

  it("无 knowledge:edit 能力时不渲染沉淀入口", async () => {
    const runtime = { knowledgeRepository: createMockKnowledgeRepository() } as unknown as NonNullable<
      Parameters<typeof LogsPage>[0]["runtime"]
    >;
    render(
      <ToastProvider>
        <LogsPage
          state={userState}
          dispatch={() => undefined}
          onNavigate={() => undefined}
          search=""
          runtime={runtime}
          knowledgeCapability={{ userId: "u-xu-yun", canView: true, canEdit: false, canManage: false }}
        />
      </ToastProvider>
    );

    selectCompleteLog();
    await userEvent.setup().click(screen.getByRole("button", { name: "更多" }));
    expect(screen.queryByRole("menuitem", { name: /沉淀为知识/ })).not.toBeInTheDocument();
    // The rest of the conclusion actions stay intact.
    expect(screen.getByRole("menuitem", { name: /导出报告/ })).toBeInTheDocument();
  });
});
