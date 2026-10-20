import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeDefinition, CATALOG_MODULE_ID } from "@/application/parameter-catalog/fixtures";
import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { AuthContextDto } from "@/infrastructure/http/authClient";
import { CatalogOrganizationSurface } from "./CatalogOrganizationSurface";

type Roles = readonly AuthContextDto["roles"][number][] | null;

function setup({ roles = [{ roleId: "platform-admin", projectId: null }], search: initialSearch = "",
  lifecycle = "active", currentPersonId = "admin", organizationId }: {
  roles?: Roles; search?: string; lifecycle?: "active" | "deprecated" | "retired";
  currentPersonId?: string; organizationId?: string;
} = {}) {
  const ports = createMockCatalogPorts();
  if (lifecycle !== "active") {
    const listDefinitions = ports.catalog.listDefinitions;
    vi.spyOn(ports.catalog, "listDefinitions").mockImplementation(async (query) => {
      const response = await listDefinitions(query);
      return { ...response, items: response.items.map((item) => ({ ...item, lifecycle })) };
    });
  }
  const anchors = vi.fn();
  const surface = ports.catalog.getPublicationSurface;
  vi.spyOn(ports.catalog, "getPublicationSurface").mockImplementation(async () => ({
    item: { ...(await surface()).item, authoringAllowed: false, publishingAllowed: false,
      blockers: ["publication-policy-disabled"] }
  }));
  function Harness() {
    const [search, setSearch] = useState(initialSearch);
    return <CatalogOrganizationSurface {...ports} actor="platform-admin" sessionRoles={roles}
      currentPersonId={currentPersonId} organizationId={organizationId} search={search} onAnchorChange={(href, mode) => {
        anchors(href, mode);
        setSearch(new URL(href, window.location.origin).search);
      }} />;
  }
  const view = render(<Harness />);
  return { ...ports, anchors, ...view };
}

describe("platform definition deletion", () => {
  beforeEach(() => localStorage.clear());
  it("does not infer deletion permission from the legacy actor prop when session roles are absent", async () => {
    const ports = createMockCatalogPorts();
    render(<CatalogOrganizationSurface {...ports} actor="platform-admin" currentPersonId="admin"
      search="" onAnchorChange={vi.fn()} />);
    await screen.findByRole("button", { name: new RegExp(`^(编辑|查看) ${activeDefinition.propertyKey}$`) });
    expect(screen.queryByRole("button", { name: `彻底删除 ${activeDefinition.propertyKey}` })).not.toBeInTheDocument();
  });
  it.each<Roles>([
    null, [{ roleId: "admin", projectId: null }], [{ roleId: "platform-admin", projectId: "project-1" }]
  ])("requires a global platform role from the authoritative session: %j", async (roles) => {
    setup({ roles });
    await screen.findByRole("button", { name: `查看 ${activeDefinition.propertyKey}` });
    expect(screen.queryByRole("button", { name: `彻底删除 ${activeDefinition.propertyKey}` })).not.toBeInTheDocument();
  });

  it.each(["active", "deprecated", "retired"] as const)("offers deletion for %s definitions even with publication disabled", async (lifecycle) => {
    setup({ lifecycle });
    await waitFor(() => expect(screen.getByRole("button", { name: `彻底删除 ${activeDefinition.propertyKey}` })).toBeEnabled());
  });

  it("deletes with one impact confirmation and clears detail selection while preserving filters and navigation", async () => {
    const initialSearch = `?definitionId=${activeDefinition.id}&q=${activeDefinition.propertyKey}&lifecycle=active&moduleNodeId=module:${CATALOG_MODULE_ID}&revisionId=old-revision`;
    const { catalog, anchors } = setup({ search: initialSearch });
    const remove = vi.spyOn(catalog, "deleteDefinition");
    const preview = vi.spyOn(catalog, "previewDefinitionDeletion");
    const user = userEvent.setup();
    const detail = await screen.findByRole("dialog", { name: `查看 ${activeDefinition.propertyKey}` });
    await user.click(within(detail).getByRole("button", { name: "彻底删除此定义" }));
    const dialog = await screen.findByRole("dialog", { name: `彻底删除 ${activeDefinition.propertyKey}` });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "彻底删除" })).toBeEnabled());
    expect(dialog).toHaveTextContent("全平台");
    expect(dialog).toHaveTextContent("删除后无法恢复");
    expect(dialog).toHaveTextContent("原始 DTS / JSON 配置文件保留");
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "彻底删除" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(preview).toHaveBeenCalledWith(activeDefinition.id);
    expect(remove).toHaveBeenCalledWith(activeDefinition.id, { previewToken: expect.any(String) });
    const latest = new URL(anchors.mock.lastCall![0], window.location.origin);
    expect(latest.searchParams.get("definitionId")).toBeNull();
    expect(latest.searchParams.get("revisionId")).toBeNull();
    expect(latest.searchParams.get("q")).toBe(activeDefinition.propertyKey);
    expect(latest.searchParams.get("lifecycle")).toBe("active");
    expect(latest.searchParams.get("moduleNodeId")).toBe(`module:${CATALOG_MODULE_ID}`);
    expect(await screen.findByLabelText("结果计数")).toHaveTextContent("共 0 项");
  });

  it("keeps a failed deletion open and requires a fresh preview before retrying", async () => {
    const { catalog } = setup();
    const remove = vi.spyOn(catalog, "deleteDefinition").mockRejectedValueOnce(new WiseEffApiError(
      "CONFLICT", "关联数据已变化", { reason: "definition-deletion-stale" }, "test"
    ));
    const preview = vi.spyOn(catalog, "previewDefinitionDeletion");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `彻底删除 ${activeDefinition.propertyKey}` }));
    const dialog = await screen.findByRole("dialog", { name: `彻底删除 ${activeDefinition.propertyKey}` });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "彻底删除" })).toBeEnabled());
    await user.click(within(dialog).getByRole("button", { name: "彻底删除" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("关联数据已变化");
    expect(within(dialog).getByRole("button", { name: "彻底删除" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "刷新删除影响" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "彻底删除" })).toBeEnabled());
    expect(preview).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `彻底删除 ${activeDefinition.propertyKey}` })).toBeVisible();
  });

  it("never enables confirmation when impact loading fails and cancels without deleting", async () => {
    const { catalog } = setup();
    vi.spyOn(catalog, "previewDefinitionDeletion").mockRejectedValue(new Error("影响暂不可用"));
    const remove = vi.spyOn(catalog, "deleteDefinition");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `彻底删除 ${activeDefinition.propertyKey}` }));
    const dialog = await screen.findByRole("dialog", { name: `彻底删除 ${activeDefinition.propertyKey}` });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("影响暂不可用");
    expect(within(dialog).getByRole("button", { name: "彻底删除" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
  });

  it("retries committed archive cleanup with the original token instead of loading a missing definition", async () => {
    const { catalog } = setup();
    const remove = vi.spyOn(catalog, "deleteDefinition").mockRejectedValueOnce(new WiseEffApiError(
      "INTERNAL_ERROR", "Object storage unavailable", { reason: "definition-erasure-cleanup-pending" }, "test"
    )).mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce({ item: { definitionId: activeDefinition.id, deleted: true,
      counts: { definitions: 1 }, originalFilesRetained: true } });
    const preview = vi.spyOn(catalog, "previewDefinitionDeletion");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `彻底删除 ${activeDefinition.propertyKey}` }));
    const dialog = await screen.findByRole("dialog", { name: `彻底删除 ${activeDefinition.propertyKey}` });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "彻底删除" })).toBeEnabled());
    await user.click(within(dialog).getByRole("button", { name: "彻底删除" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("定义记录已移除，但归档清理未完成。请重试完成清理。");
    expect(within(dialog).getByRole("button", { name: "刷新删除影响" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "重试清理归档" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "重试清理归档" })).toBeEnabled());
    expect(preview).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole("button", { name: "重试清理归档" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(remove).toHaveBeenCalledTimes(3);
    expect(remove.mock.calls[1]).toEqual(remove.mock.calls[0]);
    expect(remove.mock.calls[2]).toEqual(remove.mock.calls[0]);
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it("restores pending cleanup after remount and retries the same definition and token without another preview", async () => {
    const first = setup({ currentPersonId: "admin-a", organizationId: "org-a" });
    const remove = vi.spyOn(first.catalog, "deleteDefinition").mockRejectedValueOnce(new WiseEffApiError(
      "INTERNAL_ERROR", "archive unavailable", { reason: "definition-erasure-cleanup-pending" }, "test"
    )).mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce({ item: { definitionId: activeDefinition.id, deleted: true, counts: {}, originalFilesRetained: true } });
    const preview = vi.spyOn(first.catalog, "previewDefinitionDeletion");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `彻底删除 ${activeDefinition.propertyKey}` }));
    const dialog = await screen.findByRole("dialog", { name: `彻底删除 ${activeDefinition.propertyKey}` });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "彻底删除" })).toBeEnabled());
    await user.click(within(dialog).getByRole("button", { name: "彻底删除" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("定义记录已移除");
    const key = "wiseeff:definition-deletion-cleanup:admin-a:org-a";
    const saved = JSON.parse(localStorage.getItem(key)!);
    expect(saved).toEqual([{ definitionId: activeDefinition.id, previewToken: remove.mock.calls[0]![1].previewToken }]);
    first.unmount();

    render(<CatalogOrganizationSurface catalog={first.catalog} governance={first.governance} actor="platform-admin"
      sessionRoles={[{ roleId: "platform-admin", projectId: null }]} currentPersonId="admin-a" organizationId="org-a"
      search="" onAnchorChange={vi.fn()} />);
    const recovery = await screen.findByRole("region", { name: "待完成归档清理" });
    expect(recovery).toHaveTextContent("有参数删除待确认或待完成归档清理");
    await user.click(within(recovery).getByRole("button", { name: "重试清理" }));
    expect(await within(recovery).findByRole("alert")).toHaveTextContent("network unavailable");
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(saved);
    await user.click(within(recovery).getByRole("button", { name: "重试清理" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "待完成归档清理" })).not.toBeInTheDocument());
    expect(remove.mock.calls[1]).toEqual(remove.mock.calls[0]);
    expect(remove.mock.calls[2]).toEqual(remove.mock.calls[0]);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("retains an unknown initial DELETE result across closing and remounting, then retries the same token", async () => {
    const first = setup({ currentPersonId: "network-admin", organizationId: "org-a" });
    const remove = vi.spyOn(first.catalog, "deleteDefinition").mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ item: { definitionId: activeDefinition.id, deleted: true, counts: {}, originalFilesRetained: true } });
    const preview = vi.spyOn(first.catalog, "previewDefinitionDeletion");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `彻底删除 ${activeDefinition.propertyKey}` }));
    const dialog = await screen.findByRole("dialog", { name: `彻底删除 ${activeDefinition.propertyKey}` });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "彻底删除" })).toBeEnabled());
    await user.click(within(dialog).getByRole("button", { name: "彻底删除" }));
    const error = await within(dialog).findByRole("alert");
    expect(error).toHaveTextContent("删除结果待确认，可重试核实并完成清理");
    expect(error).not.toHaveTextContent("已移除");
    expect(within(dialog).getByRole("button", { name: "重试确认删除" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "刷新删除影响" })).toBeDisabled();
    const key = "wiseeff:definition-deletion-cleanup:network-admin:org-a";
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual([
      { definitionId: activeDefinition.id, previewToken: remove.mock.calls[0]![1].previewToken }
    ]);
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.getByRole("region", { name: "待完成归档清理" })).toHaveTextContent("有参数删除待确认或待完成归档清理");
    first.unmount();
    render(<CatalogOrganizationSurface catalog={first.catalog} governance={first.governance} actor="platform-admin"
      sessionRoles={[{ roleId: "platform-admin", projectId: null }]} currentPersonId="network-admin" organizationId="org-a"
      search="" onAnchorChange={vi.fn()} />);
    const recovery = await screen.findByRole("region", { name: "待完成归档清理" });
    await user.click(within(recovery).getByRole("button", { name: "重试清理" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "待完成归档清理" })).not.toBeInTheDocument());
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove.mock.calls[1]).toEqual(remove.mock.calls[0]);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it.each([
    ["FORBIDDEN", "forbidden"], ["NOT_FOUND", "definition-not-found"], ["CONFLICT", "definition-deletion-stale"]
  ] as const)("keeps a known %s response on the preview refresh path", async (code, reason) => {
    const { catalog } = setup();
    vi.spyOn(catalog, "deleteDefinition").mockRejectedValue(new WiseEffApiError(code, "删除被拒绝", { reason }, "test"));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `彻底删除 ${activeDefinition.propertyKey}` }));
    const dialog = await screen.findByRole("dialog", { name: `彻底删除 ${activeDefinition.propertyKey}` });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "彻底删除" })).toBeEnabled());
    await user.click(within(dialog).getByRole("button", { name: "彻底删除" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("刷新删除影响后重试");
    expect(within(dialog).getByRole("button", { name: "彻底删除" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "刷新删除影响" })).toBeEnabled();
    expect(localStorage.getItem("wiseeff:definition-deletion-cleanup:admin:")).toBeNull();
  });

  it("isolates cleanup by account and organization and never reads it without a platform role", async () => {
    const ports = createMockCatalogPorts();
    const key = "wiseeff:definition-deletion-cleanup:admin-a:org-a";
    localStorage.setItem(key, JSON.stringify([{ definitionId: activeDefinition.id, previewToken: "saved-token" }]));
    const reads = vi.spyOn(Storage.prototype, "getItem");
    const remove = vi.spyOn(ports.catalog, "deleteDefinition").mockResolvedValue({ item: {
      definitionId: activeDefinition.id, deleted: true, counts: {}, originalFilesRetained: true
    } });
    const base = { ...ports, actor: "platform-admin" as const, search: "", onAnchorChange: vi.fn() };
    const { rerender } = render(<CatalogOrganizationSurface {...base} currentPersonId="admin-b" organizationId="org-a"
      sessionRoles={[{ roleId: "platform-admin", projectId: null }]} />);
    await screen.findByRole("button", { name: new RegExp(`^(编辑|查看) ${activeDefinition.propertyKey}$`) });
    expect(screen.queryByRole("region", { name: "待完成归档清理" })).not.toBeInTheDocument();
    rerender(<CatalogOrganizationSurface {...base} currentPersonId="admin-a" organizationId="org-b"
      sessionRoles={[{ roleId: "platform-admin", projectId: null }]} />);
    expect(screen.queryByRole("region", { name: "待完成归档清理" })).not.toBeInTheDocument();
    rerender(<CatalogOrganizationSurface {...base} currentPersonId="admin-a" organizationId="org-a"
      sessionRoles={[{ roleId: "admin", projectId: null }]} />);
    expect(screen.queryByRole("region", { name: "待完成归档清理" })).not.toBeInTheDocument();
    expect(reads.mock.calls.some(([readKey]) => readKey === key)).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    rerender(<CatalogOrganizationSurface {...base} currentPersonId="admin-a" organizationId="org-a"
      sessionRoles={[{ roleId: "platform-admin", projectId: null }]} />);
    const recovery = await screen.findByRole("region", { name: "待完成归档清理" });
    await userEvent.click(within(recovery).getByRole("button", { name: "重试清理" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(activeDefinition.id, { previewToken: "saved-token" }));
    reads.mockRestore();
  });
});
