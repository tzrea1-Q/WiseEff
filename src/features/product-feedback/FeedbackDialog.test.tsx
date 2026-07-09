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
});
