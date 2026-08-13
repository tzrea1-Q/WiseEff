import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import App from "./App";
import { ToastProvider } from "@/components/common/toast/ToastProvider";
import { LogsPage } from "@/features/log-analysis/LogsPage";
import type { KnowledgeCapability } from "@/domain/knowledge/rules";
import { initialState } from "./mockData";

const userState = { ...initialState, activeRoleId: "user" };

type LogsPageRuntime = NonNullable<Parameters<typeof LogsPage>[0]["runtime"]>;

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

function renderStandaloneLogsPage(options: {
  relatedToLog: () => Promise<{ items: unknown[]; retrieval: unknown }>;
  capability?: KnowledgeCapability;
}) {
  const runtime = {
    knowledgeRepository: { relatedToLog: options.relatedToLog }
  } as unknown as LogsPageRuntime;
  render(
    <ToastProvider>
      <LogsPage
        state={userState}
        dispatch={() => undefined}
        onNavigate={() => undefined}
        search=""
        runtime={runtime}
        knowledgeCapability={options.capability ?? { userId: "u-xu-yun", canView: true, canEdit: false, canManage: false }}
      />
    </ToastProvider>
  );
  selectCompleteLog();
}

describe("LogsPage · 相关知识", () => {
  it("Complete 日志展示相关已发布知识与检索模式说明,深链进入 /knowledge 条目详情", async () => {
    renderLogsPage();
    selectCompleteLog();

    const section = await screen.findByRole("region", { name: "相关知识" });
    const entryLink = await within(section).findByRole("button", { name: /PD 快充协议兼容性排查手册/ });
    expect(within(section).getByText(/仅全文检索/)).toBeInTheDocument();
    // Draft and archived fixtures never appear (published-only invariant).
    expect(within(section).queryByText(/小泽沉淀/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/已归档/)).not.toBeInTheDocument();

    fireEvent.click(entryLink);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/knowledge");
    });
    expect(window.location.search).toContain("entryId=mock-kb-8");
    const detail = await screen.findByRole("dialog", { name: /PD 快充协议兼容性排查手册/ });
    expect(within(detail).getByText("已发布")).toBeInTheDocument();
  });

  it("Processing 日志不渲染相关知识区块", () => {
    renderLogsPage();

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /charging_thermal_trace/ }));

    expect(screen.queryByRole("region", { name: "相关知识" })).not.toBeInTheDocument();
  });

  it("无 knowledge:view 能力时隐藏相关知识区块", () => {
    renderStandaloneLogsPage({
      relatedToLog: async () => ({ items: [], retrieval: { mode: "fts_only", vectorAvailable: false, embeddingConfigured: false } }),
      capability: { userId: "u-xu-yun", canView: false, canEdit: false, canManage: false }
    });

    expect(screen.queryByRole("region", { name: "相关知识" })).not.toBeInTheDocument();
  });

  it("没有相关条目时展示诚实空态「暂无相关知识」", async () => {
    renderStandaloneLogsPage({
      relatedToLog: async () => ({ items: [], retrieval: { mode: "fts_only", vectorAvailable: false, embeddingConfigured: false } })
    });

    const section = await screen.findByRole("region", { name: "相关知识" });
    expect(await within(section).findByText("暂无相关知识")).toBeInTheDocument();
  });

  it("加载失败时展示错误态与重试入口", async () => {
    let failures = 0;
    renderStandaloneLogsPage({
      relatedToLog: async () => {
        if (failures === 0) {
          failures += 1;
          throw new Error("检索服务不可用");
        }
        return { items: [], retrieval: { mode: "fts_only", vectorAvailable: false, embeddingConfigured: false } };
      }
    });

    const section = await screen.findByRole("region", { name: "相关知识" });
    const alert = await within(section).findByRole("alert");
    expect(alert).toHaveTextContent("检索服务不可用");

    fireEvent.click(within(alert).getByRole("button", { name: "重试" }));
    expect(await within(section).findByText("暂无相关知识")).toBeInTheDocument();
  });
});
