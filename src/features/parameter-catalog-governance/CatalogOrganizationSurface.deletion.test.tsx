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

  it("lists every server receipt for another administrator and retries the chosen entry after a failure", async () => {
    const ports = createMockCatalogPorts();
    const entries = ["deleted-a", "deleted-b"].map(definitionId => ({ definitionId,
      deletedAt: "2026-10-21T00:00:00.000Z", pendingObjectCount: 2 }));
    const list = vi.spyOn(ports.catalog, "listDefinitionErasures").mockImplementation(async () => ({ items: entries }));
    const retry = vi.spyOn(ports.catalog, "retryDefinitionCleanup").mockRejectedValueOnce(new Error("存储暂不可用"))
      .mockImplementationOnce(async definitionId => {
        entries.splice(entries.findIndex(entry => entry.definitionId === definitionId), 1);
        return { item: { definitionId, deleted: true, counts: {}, originalFilesRetained: true } };
      });
    const remove = vi.spyOn(ports.catalog, "deleteDefinition");
    const reads = vi.spyOn(Storage.prototype, "getItem");
    localStorage.setItem("wiseeff:definition-deletion-cleanup:admin:org-a", "obsolete");
    render(<CatalogOrganizationSurface {...ports} actor="platform-admin" currentPersonId="another-admin" organizationId="org-a"
      sessionRoles={[{ roleId: "platform-admin", projectId: null }]} search="" onAnchorChange={vi.fn()} />);
    const region = await screen.findByRole("region", { name: "待完成存储清理" });
    expect(region).toHaveTextContent("待完成存储清理（2）");
    const user = userEvent.setup();
    await user.click(within(region).getByRole("button", { name: "继续清理 deleted-a" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("存储暂不可用");
    await user.click(within(region).getByRole("button", { name: "继续清理 deleted-b" }));
    await waitFor(() => expect(region).toHaveTextContent("待完成存储清理（1）"));
    expect(retry.mock.calls).toEqual([["deleted-a"], ["deleted-b"]]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(remove).not.toHaveBeenCalled();
    expect(reads.mock.calls.some(([key]) => String(key).startsWith("wiseeff:definition-deletion-cleanup:"))).toBe(false);
    reads.mockRestore();
  });

  it.each([false, true])("re-reads an uncertain deletion (committed: %s) instead of replaying its token", async committed => {
    const { catalog } = setup();
    const actualDelete = catalog.deleteDefinition!;
    const list = vi.spyOn(catalog, "listDefinitionErasures");
    const remove = vi.spyOn(catalog, "deleteDefinition").mockImplementationOnce(async (id, body) => {
      if (committed) {
        await actualDelete(id, body);
        list.mockResolvedValue({ items: [{ definitionId: id, deletedAt: "2026-10-21T00:00:00.000Z", pendingObjectCount: 1 }] });
      }
      throw new TypeError("Failed to fetch");
    });
    const preview = vi.spyOn(catalog, "previewDefinitionDeletion");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `彻底删除 ${activeDefinition.propertyKey}` }));
    const dialog = await screen.findByRole("dialog", { name: `彻底删除 ${activeDefinition.propertyKey}` });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "彻底删除" })).toBeEnabled());
    await user.click(within(dialog).getByRole("button", { name: "彻底删除" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    if (committed) {
      expect(await screen.findByRole("region", { name: "待完成存储清理" })).toHaveTextContent(activeDefinition.id);
      expect(await screen.findByLabelText("结果计数")).toHaveTextContent("共 0 项");
    } else {
      await user.click(await screen.findByRole("button", { name: `彻底删除 ${activeDefinition.propertyKey}` }));
      await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole("region", { name: "待完成存储清理" })).not.toBeInTheDocument();
    }
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("refreshes durable receipts after committed cleanup fails", async () => {
    const { catalog } = setup();
    const list = vi.spyOn(catalog, "listDefinitionErasures");
    vi.spyOn(catalog, "deleteDefinition").mockImplementationOnce(async () => {
      list.mockResolvedValue({ items: [{ definitionId: activeDefinition.id, deletedAt: "2026-10-21T00:00:00.000Z", pendingObjectCount: 1 }] });
      throw new WiseEffApiError("CONFLICT", "清理未完成", { reason: "definition-erasure-cleanup-pending" }, "test");
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `彻底删除 ${activeDefinition.propertyKey}` }));
    const dialog = await screen.findByRole("dialog", { name: `彻底删除 ${activeDefinition.propertyKey}` });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "彻底删除" })).toBeEnabled());
    await user.click(within(dialog).getByRole("button", { name: "彻底删除" }));
    expect(await screen.findByRole("region", { name: "待完成存储清理" })).toHaveTextContent(activeDefinition.id);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

  it("does not read cleanup without a platform role", async () => {
    const { catalog } = setup({ roles: [{ roleId: "admin", projectId: null }] });
    const list = vi.spyOn(catalog, "listDefinitionErasures");
    await screen.findByRole("button", { name: `查看 ${activeDefinition.propertyKey}` });
    expect(list).not.toHaveBeenCalled();
  });
  it("allows a failed server-list read to be retried", async () => {
    const ports = createMockCatalogPorts();
    const list = vi.spyOn(ports.catalog, "listDefinitionErasures").mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ items: [{ definitionId: "deleted", deletedAt: "2026-10-21T00:00:00.000Z", pendingObjectCount: 1 }] });
    render(<CatalogOrganizationSurface {...ports} actor="platform-admin" currentPersonId="admin"
      sessionRoles={[{ roleId: "platform-admin", projectId: null }]} search="" onAnchorChange={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取待完成存储清理");
    await userEvent.setup().click(screen.getByRole("button", { name: "重试读取" }));
    expect(await screen.findByRole("button", { name: "继续清理 deleted" })).toBeEnabled();
    expect(list).toHaveBeenCalledTimes(2);
  });
});
