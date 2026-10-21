import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";
import { KnowledgePage } from "./KnowledgePage";

const capability = { userId: "u-xu-yun", canView: true, canEdit: true, canManage: false };

describe("knowledge reference suggestions", () => {
  it("groups ambiguous suggestions, accepts independently, dismisses and accepts all remaining items", async () => {
    const repository = createMockKnowledgeRepository({ canManage: false });
    const entry = await repository.createMarkdown({ title: "建议测试", tags: [], contentMarkdown: "iin_max" });
    let items = ["module-a", "module-b", "module-c"].map((driverModule, index) => ({
      definitionId: `pdef-${index}`, propertyKey: "iin_max", displayName: "输入电流", driverModule,
      lifecycle: index === 1 ? "deprecated" as const : "active" as const,
      mentionCount: 3, snippet: "iin_max 调参说明", page: 2, detectedRevisionId: "detected-revision-1"
    }));
    vi.spyOn(repository, "listReferenceSuggestions").mockImplementation(async () => items);
    const accept = vi.spyOn(repository, "acceptReferenceSuggestion").mockImplementation(async (_id, definitionId) => {
      items = items.filter((item) => item.definitionId !== definitionId);
      return { ...entry, parameterReferences: [] };
    });
    const dismiss = vi.spyOn(repository, "dismissReferenceSuggestion").mockImplementation(async (_id, definitionId) => {
      items = items.filter((item) => item.definitionId !== definitionId);
    });
    render(<KnowledgePage repository={repository} capability={capability} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText(entry.title));
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const section = await screen.findByRole("region", { name: "建议关联" });
    expect(within(section).getAllByText("iin_max")).toHaveLength(1);
    expect(section).toHaveTextContent("已弃用");
    expect(section).toHaveTextContent("第 2 页");
    await user.click(within(section).getAllByRole("button", { name: "接受" })[0]!);
    await waitFor(() => expect(accept).toHaveBeenCalledWith(entry.id, "pdef-0"));
    expect(section).toHaveTextContent("module-b");
    await user.click(within(section).getAllByRole("button", { name: "忽略" })[0]!);
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith(entry.id, "pdef-1"));
    await user.click(within(section).getByRole("button", { name: "全部接受" }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith(entry.id, "pdef-2"));
    expect(await within(section).findByText("暂无建议关联。")).toBeInTheDocument();
  });

  it("never loads suggestions for a reader", async () => {
    const repository = createMockKnowledgeRepository();
    const list = vi.spyOn(repository, "listReferenceSuggestions");
    const entry = (await repository.list()).items.find((item) => item.status === "published")!;
    render(<KnowledgePage repository={repository} capability={{ ...capability, canEdit: false }} />);
    await userEvent.setup().click(await screen.findByText(entry.title));
    expect(screen.queryByRole("region", { name: "建议关联" })).not.toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it("lets a manager govern file suggestions without a markdown save and retries a failed read", async () => {
    const repository = createMockKnowledgeRepository();
    const entry = await repository.createFile({ title: "文件建议", tags: [], file: new File(["%PDF-test"], "manual.pdf", { type: "application/pdf" }) });
    const list = vi.spyOn(repository, "listReferenceSuggestions").mockRejectedValueOnce(new Error("建议读取失败"));
    render(<KnowledgePage repository={repository} capability={{ ...capability, canEdit: false, canManage: true }} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText(entry.title));
    await user.click(screen.getByRole("button", { name: "关联参数定义" }));
    const editor = screen.getByRole("dialog", { name: "关联参数定义" });
    expect(within(editor).queryByLabelText("Markdown 内容")).not.toBeInTheDocument();
    expect(within(editor).queryByRole("button", { name: "保存为新修订" })).not.toBeInTheDocument();
    expect(await within(editor).findByRole("alert")).toHaveTextContent("建议读取失败");
    await user.click(within(editor).getByRole("button", { name: "重试" }));
    expect(await within(editor).findByText("暂无建议关联。")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });
});
