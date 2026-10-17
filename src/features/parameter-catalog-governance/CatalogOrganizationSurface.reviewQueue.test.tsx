import { render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { CATALOG_ORGANIZATION_ID, catalogReviewItem, CATALOG_SUBJECT_ID } from "@/application/parameter-catalog/fixtures";
import { CatalogOrganizationSurface } from "./CatalogOrganizationSurface";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";

describe("CatalogOrganizationSurface Organization Review Queue permission", () => {
  it("uses one review container, protects a dirty embedded editor and returns focus to the queue", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    function Host() {
      const [search, setSearch] = useState("?review=open");
      return <CatalogOrganizationSurface {...ports} actor="org-admin" search={search}
        organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="admin"
        onAnchorChange={(href) => setSearch(new URL(href, "http://localhost").search)} />;
    }
    render(<Host />);
    const queue = await screen.findByRole("dialog", { name: "待审核事项" });
    await waitFor(() => expect(screen.getByRole("region", { name: "参数定义目录" }))
      .toHaveAttribute("data-catalog-state", "ready"));
    await userEvent.click(await within(queue).findByRole("button", { name: "处理审核" }));
    const editor = await screen.findByRole("dialog", { name: "处理审核" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await userEvent.type(within(editor).getByRole("textbox", { name: "原因" }), "保留审核草稿");
    await userEvent.keyboard("{Escape}");
    const discard = await screen.findByRole("dialog", { name: "放弃未保存的审核处理？" });
    await userEvent.click(within(discard).getByRole("button", { name: "继续编辑" }));
    expect(screen.getByRole("textbox", { name: "原因" })).toHaveValue("保留审核草稿");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(await screen.findByRole("dialog", { name: "放弃未保存的审核处理？" })).getByRole("button", { name: "放弃修改" }));
    const list = await screen.findByRole("dialog", { name: "待审核事项" });
    expect(within(list).getByRole("heading", { name: "待审核事项" })).toHaveFocus();
    expect(within(list).getByRole("button", { name: "处理审核" })).toBeVisible();
  });

  it("releases queue count overrides on close so a later catalog read can show newly arrived work", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const list = vi.spyOn(ports.governance, "listReviewItems");
    const props = { ...ports, actor: "org-admin" as const, organizationId: CATALOG_ORGANIZATION_ID,
      currentPersonId: "admin", onAnchorChange: vi.fn() };
    const view = render(<CatalogOrganizationSurface {...props} search="?review=open" />);
    const dialog = await screen.findByRole("dialog", { name: "待审核事项" });
    await within(dialog).findByRole("table");
    await waitFor(() => expect(screen.getByRole("button", { name: /待审核事项/ })).toHaveTextContent("1"));
    await userEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    list.mockResolvedValue({ items: [catalogReviewItem], nextCursor: "next", totalCount: 4, hasMore: true,
      catalogReleaseId: catalogReviewItem.catalogReleaseId });
    view.rerender(<CatalogOrganizationSurface {...props} search="?q=gpio" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /待审核事项/ })).toHaveTextContent("4"));
  });
  it("distinguishes same-named review destinations by their complete module paths", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const module = (id: string, name: string, parentId: string | null, kind: ParameterModule["kind"]): ParameterModule => ({
      id, name, parentId, kind, sortOrder: 0, description: "", scope: "", importance: "medium", origin: "curated",
      sourceKey: null, effectiveImportance: "medium", parameterCount: 0, definitionCount: 0
    });
    const moduleRegistry = { getRegistry: vi.fn().mockResolvedValue({ mappings: [], modules: [
      module("root-a", "充电", null, "business"), module("root-b", "电池", null, "business"),
      module("target-a", "控制器", "root-a", "driver-group"), module("target-b", "控制器", "root-b", "driver-group")
    ] }) };
    render(<CatalogOrganizationSurface {...ports} actor="org-admin" search="?review=open" moduleRegistry={moduleRegistry}
      organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="admin" onAnchorChange={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "处理审核" }));
    await userEvent.click(screen.getByRole("combobox", { name: "审核登记目标模块" }));
    expect(await screen.findByRole("option", { name: "充电 / 控制器" })).toBeVisible();
    expect(screen.getByRole("option", { name: "电池 / 控制器" })).toBeVisible();
  });
  it("continues a recorded definition intent in the current definition workspace with exact review context", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const list = ports.governance.listReviewItems;
    vi.spyOn(ports.governance, "listReviewItems").mockImplementation(async (org, query) => ({
      ...await list(org, query), items: [{ ...catalogReviewItem, allowedResolutions: ["open-definition-proposal"] }]
    }));
    vi.spyOn(ports.governance, "getReviewItem").mockResolvedValue({
      item: { ...catalogReviewItem, allowedResolutions: ["open-definition-proposal"] }
    });
    const onAnchorChange = vi.fn();
    render(<CatalogOrganizationSurface {...ports} actor="org-admin" search="?review=open"
      organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="admin" onAnchorChange={onAnchorChange} />);
    await userEvent.click(await screen.findByRole("button", { name: "处理审核" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "原因" })).toBeEnabled());
    await userEvent.type(screen.getByRole("textbox", { name: "原因" }), "按观察记录更新定义");
    await userEvent.click(screen.getByRole("button", { name: "继续确认" }));
    const confirmation = await screen.findByRole("dialog", { name: "确认处理审核" });
    await userEvent.click(within(confirmation).getByRole("checkbox"));
    await userEvent.click(within(confirmation).getByRole("button", { name: "确认处理" }));
    await userEvent.click(await screen.findByRole("button", { name: "前往定义目录继续编辑" }));
    const [href] = onAnchorChange.mock.calls.at(-1)!;
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/parameter-admin/specs");
    expect(url.searchParams.get("subjectId")).toBe(CATALOG_SUBJECT_ID);
    expect(url.searchParams.get("q")).toBe("gpio-int");
    expect(url.searchParams.has("reviewItemId")).toBe(false);
  });
  it.each(["", "?review=open", "?reviewItemId=prit_bookmark"])(
    "keeps Organization review authority for a dual-role session at %s",
    async (search) => {
      const ports = createMockCatalogPorts({ scenario: "ready" });
      const listReviewItems = vi.spyOn(ports.governance, "listReviewItems");
      render(<CatalogOrganizationSurface {...ports} actor="platform-admin"
        sessionRoles={[{ roleId: "platform-admin", projectId: null }, { roleId: "admin", projectId: null }]}
        sessionPermissions={["parameter:view", "catalog:author", "catalog:publish"]} search={search}
        organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="dual-role"
        onAnchorChange={vi.fn()} />);

      expect(await screen.findByRole("button", { name: /待审核事项/ })).toBeVisible();
      expect(screen.queryByText(/Platform 权限不能代替组织审核权限/)).not.toBeInTheDocument();
      if (!search) await userEvent.setup().click(screen.getByRole("button", { name: /待审核事项/ }));
      expect(await screen.findByRole("region", { name: "待审核事项" })).toBeVisible();
      await waitFor(() => expect(listReviewItems).toHaveBeenCalledWith(CATALOG_ORGANIZATION_ID));
      expect(await screen.findByRole("button", { name: "处理审核" })).toBeEnabled();
    }
  );

  it.each(["?review=open", "?reviewItemId=prit_bookmark", ""])(
    "explains the Organization boundary without reading the queue for a Platform-only session at %s",
    async (search) => {
      const ports = createMockCatalogPorts({ scenario: "ready" });
      const listReviewItems = vi.spyOn(ports.governance, "listReviewItems")
        .mockRejectedValue(new Error("403 forbidden"));
      render(<CatalogOrganizationSurface {...ports} actor="platform-admin"
        sessionRoles={[{ roleId: "platform-admin", projectId: null }]}
        sessionPermissions={["parameter:view", "catalog:author", "catalog:publish"]} search={search}
        organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="platform-only"
        onAnchorChange={vi.fn()} />);

      expect(await screen.findByRole("region", { name: "参数定义目录" })).toBeVisible();
      expect(await screen.findByText("组织审核队列需要 Organization 权限；Platform 权限不能代替组织审核权限。"))
        .toBeVisible();
      expect(screen.queryByRole("button", { name: /待审核事项/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "待审核事项" })).not.toBeInTheDocument();
      expect(screen.queryByText(/审核队列加载失败/)).not.toBeInTheDocument();
      expect(listReviewItems).not.toHaveBeenCalled();
    }
  );

  it.each([
    { actor: "user" as const },
    { roleId: "guest" },
    {}
  ])("does not explain or read the queue for a non-permitted or unhydrated session %j", async (session) => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const listReviewItems = vi.spyOn(ports.governance, "listReviewItems");
    render(<CatalogOrganizationSurface {...ports} {...session}
      sessionPermissions={["parameter:view"]} search="?review=open"
      organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="organization-reader"
      onAnchorChange={vi.fn()} />);

    expect(screen.queryByText(/Platform 权限不能代替组织审核权限/)).not.toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "参数定义目录" })).toBeVisible();
    expect(screen.queryByText(/Platform 权限不能代替组织审核权限/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /待审核事项/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "待审核事项" })).not.toBeInTheDocument();
    expect(listReviewItems).not.toHaveBeenCalled();
  });

  it.each([null, [], [{ roleId: "guest", projectId: null }], [{ roleId: "admin", projectId: "project-only" }]])(
    "does not use a stale primary actor as Organization authority when hydrated roles are %j",
    async (sessionRoles) => {
      const ports = createMockCatalogPorts({ scenario: "ready" });
      const listReviewItems = vi.spyOn(ports.governance, "listReviewItems");
      render(<CatalogOrganizationSurface {...ports} actor="org-admin" sessionRoles={sessionRoles}
        sessionPermissions={["parameter:view", "catalog:publish"]} search="?review=open"
        organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="organization-reader"
        onAnchorChange={vi.fn()} />);

      expect(await screen.findByRole("region", { name: "参数定义目录" })).toBeVisible();
      expect(screen.queryByRole("button", { name: /待审核事项/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "待审核事项" })).not.toBeInTheDocument();
      expect(screen.queryByText(/Platform 权限不能代替组织审核权限/)).not.toBeInTheDocument();
      expect(listReviewItems).not.toHaveBeenCalled();
    }
  );

  it("hydrates a dual-role session without changing its Platform primary actor", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const listReviewItems = vi.spyOn(ports.governance, "listReviewItems");
    const props = { ...ports, actor: "platform-admin" as const, sessionPermissions: ["parameter:view"],
      search: "", organizationId: CATALOG_ORGANIZATION_ID, currentPersonId: "dual-role", onAnchorChange: vi.fn() };
    const { rerender } = render(<CatalogOrganizationSurface {...props} sessionRoles={null} />);
    expect(await screen.findByRole("region", { name: "参数定义目录" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /待审核事项/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Platform 权限不能代替组织审核权限/)).not.toBeInTheDocument();
    expect(listReviewItems).not.toHaveBeenCalled();
    rerender(<CatalogOrganizationSurface {...props}
      sessionRoles={[{ roleId: "admin", projectId: null }, { roleId: "platform-admin", projectId: null }]} />);
    expect(await screen.findByRole("button", { name: /待审核事项/ })).toBeVisible();
    expect(screen.queryByText(/Platform 权限不能代替组织审核权限/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /待审核事项/ })).toHaveTextContent("1"));
    expect(listReviewItems).toHaveBeenCalled();
  });

  it("shows the queue action after the guest role hydrates to Organization admin", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const props = { ...ports, sessionPermissions: ["parameter:view"], search: "",
      organizationId: CATALOG_ORGANIZATION_ID, currentPersonId: "organization-reader",
      onAnchorChange: vi.fn() };
    const { rerender } = render(<CatalogOrganizationSurface {...props} roleId="guest" />);

    expect(screen.queryByText(/Platform 权限不能代替组织审核权限/)).not.toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "参数定义目录" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /待审核事项/ })).not.toBeInTheDocument();
    rerender(<CatalogOrganizationSurface {...props} roleId="admin" />);
    expect(await screen.findByRole("button", { name: /待审核事项/ })).toBeVisible();
    expect(screen.queryByText(/Platform 权限不能代替组织审核权限/)).not.toBeInTheDocument();
  });

  it("keeps the Organization queue available to an Organization admin", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const listReviewItems = vi.spyOn(ports.governance, "listReviewItems");
    render(<CatalogOrganizationSurface {...ports} actor="org-admin"
      sessionPermissions={["parameter:view"]} search="?review=open"
      organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="organization-reader"
      onAnchorChange={vi.fn()} />);

    expect(await screen.findByRole("region", { name: "待审核事项" })).toBeVisible();
    await waitFor(() => expect(listReviewItems).toHaveBeenCalledWith(CATALOG_ORGANIZATION_ID));
    expect(screen.queryByText(/Platform 权限不能代替组织审核权限/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "关闭" }));
    await userEvent.setup().click(screen.getByRole("button", { name: /待审核事项/ }));
    expect(await screen.findByRole("dialog", { name: "待审核事项" })).toBeVisible();
  });
});
