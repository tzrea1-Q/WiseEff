import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import type { ProductFeedback, ProductFeedbackType } from "@/domain/productFeedback/types";
import { FeedbackDialog } from "./FeedbackDialog";

function feedback(overrides: Partial<ProductFeedback> = {}): ProductFeedback {
  return {
    id: "feedback-1",
    pagePath: "/parameter-home",
    pageTitle: "参数首页",
    feedbackType: "experience",
    description: "提交反馈",
    status: "open",
    adminNote: null,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    attachments: [],
    ...overrides
  };
}

function createFeedbackRepository(overrides: Partial<ProductFeedbackRepository> = {}): ProductFeedbackRepository {
  return {
    submit: vi.fn().mockResolvedValue(feedback()),
    list: vi.fn().mockResolvedValue({ items: [] }),
    get: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(feedback()),
    getAttachmentObjectUrl: vi.fn(),
    ...overrides
  };
}

function renderDialog(repository = createFeedbackRepository()) {
  const onOpenChange = vi.fn();
  render(
    <FeedbackDialog
      open
      pagePath="/parameter-home"
      pageTitle="参数首页"
      productFeedbackRepository={repository}
      onOpenChange={onOpenChange}
    />
  );
  return { repository, onOpenChange };
}

function imageFile(index: number) {
  return new File([`image-${index}`], `feedback-${index}.png`, { type: "image/png" });
}

function pasteImages(pasteZone: HTMLElement, files: File[]) {
  fireEvent.paste(pasteZone, { clipboardData: { files } });
}

function changeSelectValue(trigger: HTMLElement, optionName: string) {
  if (trigger instanceof HTMLSelectElement) {
    fireEvent.change(trigger, { target: { value: optionName } });
    return;
  }

  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FeedbackDialog", () => {
  it("renders pasted image thumbnails up to 5 and removes each image", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
      const file = value as File;
      return `blob:${file.name}`;
    });
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    const pasteZone = within(dialog).getByText("粘贴上传截图").closest("section") as HTMLElement;

    pasteImages(pasteZone, [imageFile(1), imageFile(2), imageFile(3)]);
    pasteImages(pasteZone, [imageFile(4), imageFile(5), imageFile(6)]);

    await waitFor(() => expect(within(dialog).getAllByAltText("问题反馈截图预览")).toHaveLength(5));
    expect(createObjectURL).toHaveBeenCalledTimes(5);
    expect(screen.getByText("最多可附加 5 张截图，请先移除已有截图后再粘贴。")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "移除截图 feedback-2.png" }));

    expect(within(dialog).getAllByAltText("问题反馈截图预览")).toHaveLength(4);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:feedback-2.png");
    expect(within(dialog).queryByAltText("feedback-2.png")).not.toBeInTheDocument();
  });

  it("uses the platform circular close icon in the header", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    const header = dialog.querySelector(".feedback-dialog-header");

    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByRole("button", { name: "关闭" })).toHaveClass("audit-dialog-close-icon");
    expect(within(dialog).queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("disables submit when the description is empty", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "问题反馈" });

    expect(within(dialog).getByRole("button", { name: "提交反馈" })).toBeDisabled();
  });

  it("submits mapped feedback type, page context, description, and images", async () => {
    const submit = vi.fn().mockResolvedValue(feedback());
    const repository = createFeedbackRepository({ submit });
    vi.spyOn(URL, "createObjectURL").mockImplementation((value) => `blob:${(value as File).name}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    renderDialog(repository);

    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    changeSelectValue(within(dialog).getByLabelText("反馈类型"), "导出/提交异常");
    fireEvent.change(within(dialog).getByLabelText("问题描述"), { target: { value: " 导出按钮提交后没有提示 " } });
    pasteImages(within(dialog).getByText("粘贴上传截图").closest("section") as HTMLElement, [imageFile(1), imageFile(2)]);

    fireEvent.click(within(dialog).getByRole("button", { name: "提交反馈" }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        pagePath: "/parameter-home",
        pageTitle: "参数首页",
        feedbackType: "export_submit" satisfies ProductFeedbackType,
        description: "导出按钮提交后没有提示",
        files: [expect.objectContaining({ name: "feedback-1.png" }), expect.objectContaining({ name: "feedback-2.png" })]
      })
    );
    expect(screen.getByText("反馈已记录，并附带 2 张粘贴截图。")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("问题描述")).toHaveValue("");
    expect(within(dialog).queryByAltText("问题反馈截图预览")).not.toBeInTheDocument();
  });

  it("retains the form and shows a readable message when submit fails", async () => {
    const submit = vi.fn().mockRejectedValue(new Error("网络暂时不可用"));
    const repository = createFeedbackRepository({ submit });
    renderDialog(repository);

    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    fireEvent.change(within(dialog).getByLabelText("问题描述"), { target: { value: "参数首页加载很慢" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "提交反馈" }));

    expect(within(dialog).getByRole("button", { name: "提交中..." })).toBeDisabled();
    expect(await screen.findByText("网络暂时不可用")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("问题描述")).toHaveValue("参数首页加载很慢");
  });

  it("maps API failures to product-language copy when submit fails", async () => {
    const { WiseEffApiError } = await import("@/infrastructure/http/apiClient");
    const submit = vi
      .fn()
      .mockRejectedValue(new WiseEffApiError("FORBIDDEN", "Forbidden", {}, "req-feedback-submit"));
    renderDialog(createFeedbackRepository({ submit }));

    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    fireEvent.change(within(dialog).getByLabelText("问题描述"), { target: { value: "按钮点不动" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交反馈" }));

    expect(await screen.findByText("没有权限执行该操作。")).toBeInTheDocument();
  });

  it("closes directly when the form is clean", () => {
    const { onOpenChange } = renderDialog();

    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog", { name: "放弃当前反馈？" })).not.toBeInTheDocument();
  });

  it("guards Escape and close with a discard confirmation while the form is dirty", async () => {
    const { onOpenChange } = renderDialog();

    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    fireEvent.change(within(dialog).getByLabelText("问题描述"), { target: { value: "还没写完的反馈" } });

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    const confirmDialog = await screen.findByRole("dialog", { name: "放弃当前反馈？" });
    expect(confirmDialog).toHaveTextContent("尚未提交的反馈将丢失");

    fireEvent.click(within(confirmDialog).getByRole("button", { name: "继续填写" }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(within(dialog).getByLabelText("问题描述")).toHaveValue("还没写完的反馈");

    // Both the header icon and the footer button route through the same guard.
    fireEvent.click(within(dialog).getAllByRole("button", { name: "关闭" })[0]!);
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "放弃当前反馈？" })).getByRole("button", { name: "放弃反馈" })
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("switches to '我的反馈' tab, displays feedback list, and views progress timeline in detail", async () => {
    const listMine = vi.fn().mockResolvedValue({
      items: [
        feedback({
          id: "fb-submitted",
          pageTitle: "日志分析",
          pagePath: "/logs",
          description: "日志加载很慢",
          status: "in_progress",
          submittedAt: "2026-07-08T08:00:00.000Z",
          latestPublicProgress: "已排查到是解析线程瓶颈",
          progressEvents: [
            {
              id: "evt-1",
              feedbackId: "fb-submitted",
              kind: "submitted",
              createdAt: "2026-07-08T08:00:00.000Z"
            },
            {
              id: "evt-2",
              feedbackId: "fb-submitted",
              kind: "progress",
              publicMessage: "已排查到是解析线程瓶颈",
              createdAt: "2026-07-08T08:30:00.000Z"
            }
          ]
        })
      ]
    });

    renderDialog(createFeedbackRepository({ listMine }));

    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    const mineTab = within(dialog).getByRole("tab", { name: /我的反馈/ });
    fireEvent.click(mineTab);

    expect(await within(dialog).findByText("日志分析")).toBeInTheDocument();
    expect(within(dialog).getByText("日志加载很慢")).toBeInTheDocument();
    expect(within(dialog).getByText("已排查到是解析线程瓶颈")).toBeInTheDocument();

    // Click row to view detail
    fireEvent.click(within(dialog).getByText("日志分析"));
    expect(await within(dialog).findByText("处理进展时间轴")).toBeInTheDocument();
    expect(within(dialog).getByText("已排查到是解析线程瓶颈")).toBeInTheDocument();

    // Click back to list
    fireEvent.click(within(dialog).getByRole("button", { name: /返回反馈列表/ }));
    expect(await within(dialog).findByText("日志分析")).toBeInTheDocument();
  });

  it("saves a draft through '保存草稿' button", async () => {
    const createDraft = vi.fn().mockResolvedValue(
      feedback({
        id: "draft-new",
        submittedAt: null,
        description: "草稿进行中"
      })
    );

    renderDialog(createFeedbackRepository({ createDraft }));

    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    fireEvent.change(within(dialog).getByLabelText("问题描述"), {
      target: { value: "草稿进行中" }
    });

    const saveDraftBtn = within(dialog).getByRole("button", { name: "保存草稿" });
    expect(saveDraftBtn).toBeEnabled();
    fireEvent.click(saveDraftBtn);

    await waitFor(() =>
      expect(createDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "草稿进行中",
          pagePath: "/parameter-home",
          pageTitle: "参数首页"
        })
      )
    );

    expect(await within(dialog).findByText("草稿已创建并保存。")).toBeInTheDocument();
  });

  it("loads a draft from '我的反馈' into the composer via '继续编辑'", async () => {
    const listMine = vi.fn().mockResolvedValue({
      items: [
        feedback({
          id: "draft-1",
          pageTitle: "参数首页",
          description: "先写了一半的草稿",
          status: "open",
          submittedAt: null
        })
      ]
    });
    const submitDraft = vi.fn().mockResolvedValue(feedback({ id: "draft-1", status: "open" }));

    renderDialog(createFeedbackRepository({ listMine, submitDraft }));

    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    fireEvent.click(within(dialog).getByRole("tab", { name: /我的反馈/ }));

    expect(await within(dialog).findByText("先写了一半的草稿")).toBeInTheDocument();
    const editBtn = within(dialog).getByRole("button", { name: "继续编辑" });
    fireEvent.click(editBtn);

    // Composer tab should be active and have description loaded
    expect(within(dialog).getByLabelText("问题描述")).toHaveValue("先写了一半的草稿");
    expect(within(dialog).getByRole("tab", { name: /提交反馈 \(编辑草稿\)/ })).toBeInTheDocument();

    // Now submit the draft
    fireEvent.click(within(dialog).getByRole("button", { name: "提交反馈" }));
    await waitFor(() =>
      expect(submitDraft).toHaveBeenCalledWith(
        "draft-1",
        expect.objectContaining({
          description: "先写了一半的草稿"
        })
      )
    );
  });
});
