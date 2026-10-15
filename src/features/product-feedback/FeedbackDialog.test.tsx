import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import type { ProductFeedback, ProductFeedbackType } from "@/domain/productFeedback/types";
import { FeedbackDialog } from "./FeedbackDialog";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";

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

async function changeSelectValue(trigger: HTMLElement, optionName: string) {
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("option", { name: optionName }));
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
    await changeSelectValue(within(dialog).getByLabelText("反馈类型"), "导出/提交异常");
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
    expect(screen.getByText("反馈已记录，并附带 2 张截图。")).toBeInTheDocument();
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
    await userEvent.click(mineTab);
    expect(within(dialog).queryByRole("link", { name: "在反馈中心打开" })).not.toBeInTheDocument();

    expect(await within(dialog).findByText("日志分析")).toBeInTheDocument();
    expect(within(dialog).getByText("日志加载很慢")).toBeInTheDocument();
    expect(within(dialog).getByText("已排查到是解析线程瓶颈")).toBeInTheDocument();

    // Click row to view detail
    fireEvent.click(within(dialog).getByText("日志分析"));
    expect(await within(dialog).findByText("处理记录")).toBeInTheDocument();
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
    await userEvent.click(within(dialog).getByRole("tab", { name: /我的反馈/ }));

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

  it("saves the empty retained attachment set and preserves a draft's original page before submission", async () => {
    const draft = feedback({ id: "draft-origin", pagePath: "/feedback-admin", pageTitle: "反馈管理", description: "原页面的问题", submittedAt: null,
      attachments: [{ id: "shot-1", feedbackId: "draft-origin", fileName: "original.png", contentType: "image/png", sizeBytes: 100, sortOrder: 0, createdAt: "2026-07-08T00:00:00.000Z" }] });
    const saveDraft = vi.fn().mockResolvedValue({ ...draft, attachments: [] });
    const submitDraft = vi.fn().mockResolvedValue({ ...draft, submittedAt: "2026-07-08T01:00:00.000Z", attachments: [] });
    const repository = createFeedbackRepository({ saveDraft, submitDraft, getMineAttachmentObjectUrl: vi.fn().mockResolvedValue("blob:original") });
    render(<FeedbackDialog open pagePath="/parameter-home" pageTitle="参数首页" initialDraft={draft} productFeedbackRepository={repository} onOpenChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "移除截图 original.png" }));
    fireEvent.click(screen.getByRole("button", { name: "提交反馈" }));
    await waitFor(() => expect(submitDraft).toHaveBeenCalledWith("draft-origin", expect.objectContaining({ pagePath: "/feedback-admin", pageTitle: "反馈管理" })));
    expect(saveDraft).toHaveBeenCalledWith("draft-origin", expect.objectContaining({ pagePath: "/feedback-admin", retainedAttachmentIds: [], newFiles: [] }));
    expect(saveDraft.mock.invocationCallOrder[0]).toBeLessThan(submitDraft.mock.invocationCallOrder[0]!);
  });

  it("tracks the saved baseline, only warns for later changes, and disables editing during a save", async () => {
    let finishSave!: (value: ProductFeedback) => void;
    const createDraft = vi.fn().mockImplementation(() => new Promise<ProductFeedback>((resolve) => { finishSave = resolve; }));
    const { onOpenChange } = renderDialog(createFeedbackRepository({ createDraft }));
    fireEvent.change(screen.getByLabelText("问题描述"), { target: { value: "草稿内容" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(screen.getByLabelText("问题描述")).toBeDisabled();
    finishSave(feedback({ id: "saved", submittedAt: null, description: "草稿内容" }));
    expect(await screen.findByText("草稿已保存")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "关闭" })[0]!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog", { name: "放弃当前反馈？" })).not.toBeInTheDocument();
  });

  it("marks saved drafts as changed and protects them when switching to a different draft", async () => {
    const draft = feedback({ id: "draft-a", description: "已保存内容", submittedAt: null });
    const other = feedback({ id: "draft-b", description: "另一份草稿", submittedAt: null });
    const repository = createFeedbackRepository({ listMine: vi.fn().mockResolvedValue({ items: [other] }) });
    render(<FeedbackDialog open pagePath="/parameter-home" pageTitle="参数首页" initialDraft={draft} productFeedbackRepository={repository} onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("问题描述"), { target: { value: "还没保存的新内容" } });
    expect(screen.getByText("有未保存的修改")).toBeInTheDocument();
    expect(screen.queryByText("草稿已保存")).not.toBeInTheDocument();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await userEvent.click(screen.getByRole("tab", { name: /我的反馈/ }));
    await userEvent.click(await screen.findByRole("button", { name: "继续编辑" }));
    const confirm = await screen.findByRole("dialog", { name: "切换到其他草稿？" });
    fireEvent.click(within(confirm).getByRole("button", { name: "继续填写" }));
    await userEvent.click(screen.getByRole("tab", { name: /提交反馈/ }));
    expect(screen.getByLabelText("问题描述")).toHaveValue("还没保存的新内容");
  });

  it("supports keyboard tab activation and keeps both tab-panel targets available", async () => {
    renderDialog(createFeedbackRepository({ listMine: vi.fn().mockResolvedValue({ items: [] }) }));
    const compose = screen.getByRole("tab", { name: "提交反馈" });
    const mine = screen.getByRole("tab", { name: "我的反馈" });
    compose.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(mine).toHaveFocus();
    expect(compose).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    expect(mine).toHaveAttribute("aria-selected", "true");
    for (const tab of [compose, mine]) expect(document.getElementById(tab.getAttribute("aria-controls")!)).toHaveAttribute("aria-labelledby", tab.id);
    expect(await screen.findByText("暂无提交记录或草稿")).toBeInTheDocument();
  });

  it("accepts file selection and validates size without discarding the written description", async () => {
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:chosen");
    renderDialog();
    fireEvent.change(screen.getByLabelText("问题描述"), { target: { value: "上传文件中的问题" } });
    const tooLarge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("选择反馈截图"), { target: { files: [tooLarge] } });
    expect(screen.getByRole("alert")).toHaveTextContent("单张截图不能超过 5 MB");
    expect(createUrl).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("选择反馈截图"), { target: { files: [imageFile(1)] } });
    expect(screen.getByAltText("问题反馈截图预览")).toBeInTheDocument();
    expect(screen.getByLabelText("问题描述")).toHaveValue("上传文件中的问题");
    await userEvent.click(screen.getByRole("button", { name: "放大截图 feedback-1.png" }));
    expect(screen.getByRole("dialog", { name: "feedback-1.png" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载截图" })).toHaveAttribute("download", "feedback-1.png");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "feedback-1.png" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "问题反馈" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "放弃当前反馈？" })).not.toBeInTheDocument();
  });

  it("uses the existing SPA leave guard to preserve unsaved composition until confirmed", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.change(screen.getByLabelText("问题描述"), { target: { value: "未保存的反馈" } });
    let decision: boolean | Promise<boolean> = false;
    act(() => { decision = requestSettingsLeave(); });
    await userEvent.click(within(screen.getByRole("dialog", { name: "放弃当前反馈？" })).getByRole("button", { name: "继续填写" }));
    expect(await decision).toBe(false);
    expect(screen.getByLabelText("问题描述")).toHaveValue("未保存的反馈");
    act(() => { decision = requestSettingsLeave(); });
    await userEvent.click(within(screen.getByRole("dialog", { name: "放弃当前反馈？" })).getByRole("button", { name: "放弃反馈" }));
    expect(await decision).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("accepts a screenshot dropped onto the description without adding it twice", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:dropped");
    renderDialog();
    fireEvent.drop(screen.getByLabelText("问题描述"), { dataTransfer: { files: [imageFile(1)] } });
    expect(screen.getAllByAltText("问题反馈截图预览")).toHaveLength(1);
  });

  it("preserves unsent replies across tabs and blocks outer close and tabs while a reply is sending", async () => {
    const submitted = feedback({ id: "submitted", description: "列表中的问题", submittedAt: "2026-07-08T00:00:00.000Z" });
    let complete!: (value: ProductFeedback) => void;
    const replyToMine = vi.fn().mockImplementation(() => new Promise<ProductFeedback>((resolve) => { complete = resolve; }));
    const { onOpenChange } = renderDialog(createFeedbackRepository({ listMine: vi.fn().mockResolvedValue({ items: [submitted] }), getMine: vi.fn().mockResolvedValue(submitted), replyToMine }));
    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    await userEvent.click(within(dialog).getByRole("tab", { name: /我的反馈/ }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "查看反馈：列表中的问题" }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "补充说明", exact: true }));
    fireEvent.change(await within(dialog).findByLabelText("补充说明"), { target: { value: "留待发送的补充" } });
    await userEvent.click(within(dialog).getByRole("tab", { name: "提交反馈" }));
    await userEvent.click(within(dialog).getByRole("tab", { name: /我的反馈/ }));
    expect(within(dialog).getByLabelText("补充说明")).toHaveValue("留待发送的补充");
    await userEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    const confirm = screen.getByRole("dialog", { name: "放弃当前反馈？" });
    expect(confirm).toHaveTextContent("未发送的补充说明和新截图也将丢失");
    await userEvent.click(within(confirm).getByRole("button", { name: "继续填写" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "发送补充" }));
    expect(within(dialog).getByRole("button", { name: "关闭" })).toBeDisabled();
    expect(within(dialog).getByRole("tab", { name: "提交反馈" })).toBeDisabled();
    const linkClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => { within(dialog).getByRole("link", { name: "反馈详情链接" }).dispatchEvent(linkClick); });
    expect(linkClick.defaultPrevented).toBe(true);
    expect(screen.queryByRole("dialog", { name: "放弃当前反馈？" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await act(async () => complete(submitted));
    expect(await within(dialog).findByText("补充说明已发送。")).toBeInTheDocument();
  });

  it("blocks tab changes while loading a draft so a late draft cannot overwrite a new composition", async () => {
    const draft = feedback({ id: "slow-draft", submittedAt: null, description: "慢速返回的草稿" });
    let complete!: (value: ProductFeedback) => void;
    renderDialog(createFeedbackRepository({ listMine: vi.fn().mockResolvedValue({ items: [draft] }),
      getMine: vi.fn().mockImplementation(() => new Promise<ProductFeedback>((resolve) => { complete = resolve; })) }));
    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    await userEvent.click(within(dialog).getByRole("tab", { name: /我的反馈/ }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "继续编辑" }));
    expect(within(dialog).getByRole("tab", { name: "提交反馈" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "关闭" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("tab", { name: "提交反馈" }));
    expect(within(dialog).getByRole("tab", { name: /我的反馈/ })).toHaveAttribute("aria-selected", "true");
    await act(async () => complete(draft));
    expect(within(dialog).getByLabelText("问题描述")).toHaveValue("慢速返回的草稿");
  });

  it("closes and releases a local screenshot preview after approved SPA leave", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-preview");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { onOpenChange } = renderDialog();
    fireEvent.change(screen.getByLabelText("选择反馈截图"), { target: { files: [imageFile(1)] } });
    await userEvent.click(screen.getByRole("button", { name: "放大截图 feedback-1.png" }));
    let decision: boolean | Promise<boolean> = false;
    act(() => { decision = requestSettingsLeave(); });
    await userEvent.click(within(screen.getByRole("dialog", { name: "放弃当前反馈？" })).getByRole("button", { name: "放弃反馈" }));
    expect(await decision).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog", { name: "feedback-1.png" })).not.toBeInTheDocument();
    expect(revoke).toHaveBeenCalledWith("blob:local-preview");
  });
});
