import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRequiredRoleForPage } from "@/app/permissions";
import type { ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import type { ProductFeedback } from "@/domain/productFeedback/types";
import { FeedbackAdminPage } from "./FeedbackAdminPage";

function feedback(overrides: Partial<ProductFeedback> = {}): ProductFeedback {
  return {
    id: "feedback-1",
    pagePath: "/parameter-home",
    pageTitle: "我的工作台",
    feedbackType: "experience",
    description: "页面切换后筛选条件丢失",
    status: "open",
    adminNote: null,
    createdAt: "2026-07-08T08:00:00.000Z",
    updatedAt: "2026-07-08T08:00:00.000Z",
    attachments: [],
    ...overrides
  };
}

function createRepository(items: ProductFeedback[], overrides: Partial<ProductFeedbackRepository> = {}): ProductFeedbackRepository {
  return {
    submit: vi.fn(),
    list: vi.fn().mockResolvedValue({ items }),
    get: vi.fn().mockImplementation(async (id: string) => items.find((item) => item.id === id) ?? null),
    update: vi.fn().mockImplementation(async (id: string, patch) => {
      const current = items.find((item) => item.id === id) ?? feedback({ id });
      return { ...current, ...patch, updatedAt: "2026-07-08T09:00:00.000Z" };
    }),
    getAttachmentObjectUrl: vi.fn().mockResolvedValue("blob:feedback-image"),
    ...overrides
  };
}

async function renderPage(repository = createRepository([feedback()])) {
  render(<FeedbackAdminPage productFeedbackRepository={repository} />);
  await screen.findByRole("table", { name: "产品反馈记录" });
  return repository;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FeedbackAdminPage", () => {
  it("renders rows from the repository list", async () => {
    await renderPage(
      createRepository([
        feedback({ id: "feedback-open", pageTitle: "参数首页", pagePath: "/parameter-home", description: "按钮状态不清楚" }),
        feedback({
          id: "feedback-closed",
          pageTitle: "日志智能分析",
          pagePath: "/logs",
          feedbackType: "data",
          description: "温升结论和证据不一致",
          status: "closed",
          attachments: [
            {
              id: "attachment-1",
              feedbackId: "feedback-closed",
              fileName: "log.png",
              contentType: "image/png",
              sizeBytes: 2048,
              sortOrder: 0,
              createdAt: "2026-07-08T08:01:00.000Z"
            }
          ]
        })
      ])
    );

    const table = screen.getByRole("table", { name: "产品反馈记录" });
    expect(screen.getByText("参数首页")).toBeInTheDocument();
    expect(screen.getByText("/parameter-home")).toBeInTheDocument();
    expect(screen.getByText("按钮状态不清楚")).toBeInTheDocument();
    expect(screen.getByText("日志智能分析")).toBeInTheDocument();
    expect(within(table).getByText("数据问题")).toBeInTheDocument();
    expect(within(table).getByText("1")).toBeInTheDocument();
    expect(screen.getByText("待处理 1 条")).toBeInTheDocument();
  });

  it("filters by status", async () => {
    await renderPage(
      createRepository([
        feedback({ id: "feedback-open", pageTitle: "开放反馈", status: "open" }),
        feedback({ id: "feedback-progress", pageTitle: "处理中反馈", status: "in_progress" })
      ])
    );

    fireEvent.change(screen.getByLabelText("状态筛选"), { target: { value: "in_progress" } });

    expect(screen.queryByText("开放反馈")).not.toBeInTheDocument();
    expect(screen.getByText("处理中反馈")).toBeInTheDocument();
    expect(screen.getByText("显示 1 / 2 条")).toBeInTheDocument();
  });

  it("updates status from the drawer through the repository", async () => {
    const repository = createRepository([feedback({ id: "feedback-open", pageTitle: "参数首页" })]);
    await renderPage(repository);

    fireEvent.click(screen.getByText("参数首页"));
    const drawer = await screen.findByRole("dialog", { name: "参数首页" });
    fireEvent.change(within(drawer).getByLabelText("处理备注"), { target: { value: "已开始排查" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "开始处理" }));

    await waitFor(() =>
      expect(repository.update).toHaveBeenCalledWith("feedback-open", {
        status: "in_progress",
        adminNote: "已开始排查"
      })
    );
    expect(await within(drawer).findByText("处理中")).toBeInTheDocument();
  });

  it("requires admin access for feedback-admin", () => {
    expect(getRequiredRoleForPage("feedback-admin")).toBe("admin");
  });
});
