import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { DtsConfigSetMemberFile } from "@/application/ports/DtsStructuredRepository";
import { CanonicalMemberRemovalSubmitDialog } from "./CanonicalMemberRemovalSubmitDialog";

describe("member removal submission recovery", () => {
  it("refreshes stale members in place without losing the reason or chosen reviewer", async () => {
    const member: DtsConfigSetMemberFile = { configSetId: "set", fileId: "file", fileName: "settings.json",
      format: "json", role: "overlay", sortOrder: 1 };
    const reload = vi.fn().mockResolvedValue([{ ...member, currentVersionId: "new-version" }]);
    const submit = vi.fn().mockRejectedValue(new WiseEffApiError("CONFLICT", "stale source", {}, "trace"));
    render(<CanonicalMemberRemovalSubmitDialog projectId="project" configSetId="set" configSetName="运行配置"
      currentUserId="author" member={member} members={[member]}
      repository={{ getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release" } }), submitMemberRemovalRequest: submit } as never}
      governanceClient={{ getProjectWorkflowRoleBindings: vi.fn().mockResolvedValue({ bindings: [
        { userId: "reviewer", name: "周工", isActive: true, roles: ["software-committer"] }
      ] }) } as never} onReloadMembers={reload} onDismiss={vi.fn()} onSubmitted={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("移除原因"), { target: { value: "保留填写内容" } });
    const button = screen.getByRole("button", { name: "提交移除审核" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const refresh = await screen.findByRole("button", { name: "重新核对配置文件" });
    expect(button).toBeDisabled();
    fireEvent.click(refresh);
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByLabelText("移除原因")).toHaveValue("保留填写内容");
    expect(screen.getByRole("combobox", { name: "指定软件审核人" })).toHaveAttribute("data-value", "reviewer");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("retains the reason through reviewer reload and submission failure, and requires a reason before submitting", async () => {
    const member: DtsConfigSetMemberFile = { configSetId: "set", fileId: "file", fileName: "settings.json",
      format: "json", role: "overlay", sortOrder: 1 };
    const loadReviewers = vi.fn().mockRejectedValueOnce(new Error("temporary directory failure"))
      .mockResolvedValue({ bindings: [
        { userId: "reviewer", name: "周工", isActive: true, roles: ["software-committer"] }
      ] });
    const submit = vi.fn().mockRejectedValue(new Error("temporary submission failure"));
    const repository = { getCatalog: vi.fn().mockResolvedValue({ item: { catalogReleaseId: "release" } }),
      submitMemberRemovalRequest: submit } as unknown as ParameterCatalogRepository;
    render(<CanonicalMemberRemovalSubmitDialog projectId="project" configSetId="set" configSetName="运行配置"
      currentUserId="author" member={member} members={[member]} repository={repository}
      governanceClient={{ getProjectWorkflowRoleBindings: loadReviewers } as never}
      onDismiss={vi.fn()} onSubmitted={vi.fn()} />);
    await screen.findByText(/加载项目软件审核人失败/);
    expect(screen.getByRole("combobox", { name: "指定软件审核人" })).toHaveTextContent("审核人加载失败");
    expect(screen.queryByRole("link", { name: "配置审核角色" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("移除原因"), { target: { value: "替换旧覆盖文件" } });
    fireEvent.click(screen.getByRole("button", { name: "重新加载审核人" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "提交移除审核" })).toBeEnabled());
    expect(screen.getByLabelText("移除原因")).toHaveValue("替换旧覆盖文件");
    fireEvent.change(screen.getByLabelText("移除原因"), { target: { value: " " } });
    expect(screen.getByRole("button", { name: "提交移除审核" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("移除原因"), { target: { value: "替换旧覆盖文件" } });
    fireEvent.click(screen.getByRole("button", { name: "提交移除审核" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("同一提交");
    expect(screen.getByLabelText("移除原因")).toHaveValue("替换旧覆盖文件");
    expect(screen.getByLabelText("移除原因")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试同一提交" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[0]).toEqual(submit.mock.calls[1]);
    expect(submit).toHaveBeenCalledWith("project", {
      configSetId: "set", fileId: "file", reason: "替换旧覆盖文件", assignedToUserId: "reviewer"
    }, expect.objectContaining({ catalogReleaseId: "release" }));
  });
});
