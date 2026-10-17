import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { activeDefinition, registeredSubject, retiredSubject, CATALOG_ORGANIZATION_ID, CATALOG_RELEASE_ID } from "@/application/parameter-catalog/fixtures";
import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { CatalogOrganizationSurface } from "./CatalogOrganizationSurface";
import { publicationSurfaceCopy, type PublicationSurfaceItem } from "./publicationSurface";

function renderSurface(authoringAllowed: boolean, surfaceOverrides: Partial<PublicationSurfaceItem> = {}, surfaceError = false) {
  const ports = createMockCatalogPorts({ scenario: "ready" });
  const readSurface = ports.catalog.getPublicationSurface;
  vi.spyOn(ports.catalog, "getPublicationSurface").mockImplementation(async () => {
    if (surfaceError) throw new Error("publication surface unavailable");
    const response = await readSurface();
    return { item: { ...response.item, authoringAllowed, publishingAllowed: false, ...surfaceOverrides } };
  });
  function Harness() {
    const [search, setSearch] = useState("");
    return <CatalogOrganizationSurface {...ports} actor="org-admin"
      sessionPermissions={["catalog:author", "catalog:publish"]}
      search={search} currentPersonId="catalog-reader"
      onAnchorChange={(href) => setSearch(new URL(href, window.location.origin).search)} />;
  }
  return render(<Harness />);
}

describe("Catalog definition action capability", () => {
  it("edits an active detail owner independently of the retired subject selected in the list", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const historical = { ...retiredSubject, id: "csub_historical" };
    vi.spyOn(ports.catalog, "listSubjects").mockImplementation(async (query) => ({
      items: query?.lifecycle === "retired" ? [historical] : [registeredSubject],
      totalCount: 1, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID
    }));
    vi.spyOn(ports.catalog, "getSubject").mockImplementation(async (id) => ({
      item: id === historical.id ? historical : registeredSubject
    }));
    vi.spyOn(ports.catalog, "listSubjectDefinitions").mockResolvedValue({
      items: [], totalCount: 0, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID
    });
    const surface = await ports.catalog.getPublicationSurface();
    vi.spyOn(ports.catalog, "getPublicationSurface").mockResolvedValue({ item: { ...surface.item,
      authoringAllowed: true, publishingAllowed: true, blockers: [] } });
    render(<CatalogOrganizationSurface {...ports} actor="org-admin"
      sessionPermissions={["catalog:author", "catalog:publish"]} currentPersonId="catalog-reader"
      search={`?subjectId=${historical.id}&definitionId=${activeDefinition.id}&catalogReleaseId=${CATALOG_RELEASE_ID}&includeRetiredSubjects=true`}
      onAnchorChange={vi.fn()} />);
    const dialog = await screen.findByRole("dialog", { name: `编辑 ${activeDefinition.propertyKey}` });
    expect(await within(dialog).findByRole("textbox", { name: "显示名" })).toHaveValue(activeDefinition.currentRevision.displayName);
    expect(within(dialog).queryByText("主体已退役 · 只读")).not.toBeInTheDocument();
  });
  it("previews restoration through the real lifecycle dialog for a historical definition under an active owner", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const retired = { ...activeDefinition, lifecycle: "retired" as const };
    vi.spyOn(ports.catalog, "listDefinitions").mockResolvedValue({ items: [retired], totalCount: 1,
      hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID });
    const surface = await ports.catalog.getPublicationSurface();
    vi.spyOn(ports.catalog, "getPublicationSurface").mockResolvedValue({ item: { ...surface.item,
      authoringAllowed: true, publishingAllowed: true, blockers: [] } });
    const preview = vi.spyOn(ports.catalog, "createPublicationCandidate");
    render(<CatalogOrganizationSurface {...ports} actor="org-admin" search=""
      sessionPermissions={["catalog:author", "catalog:publish"]} organizationId={CATALOG_ORGANIZATION_ID}
      currentPersonId="catalog-reader" onAnchorChange={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `恢复 ${retired.propertyKey}` }));
    await user.type(screen.getByLabelText("原因"), "恢复有效主体的历史定义");
    await user.click(screen.getByRole("button", { name: "预演影响" }));
    await screen.findByRole("dialog", { name: "确认恢复" });
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ changeSet: [expect.objectContaining({
      op: "restore-definition", definitionId: retired.id
    })] }), expect.objectContaining({ catalogReleaseId: CATALOG_RELEASE_ID }));
  });
  it("explains a failed publication status read in the detail", async () => {
    renderSurface(false, {}, true);
    await screen.findByText(publicationSurfaceCopy.fetchFailed);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `查看 ${activeDefinition.propertyKey}` }));
    const dialog = await screen.findByRole("dialog", { name: `查看 ${activeDefinition.propertyKey}` });
    expect(within(dialog).getByText(publicationSurfaceCopy.fetchFailed)).toBeVisible();
    expect(within(dialog).queryByText("如需编辑参数定义，请联系组织管理员开通参数目录编写权限。")).not.toBeInTheDocument();
  });
  it.each([
    ["catalog-not-adopted", publicationSurfaceCopy.notAdopted],
    ["publication-policy-disabled", publicationSurfaceCopy.policyDisabled],
    ["publication-frozen", publicationSurfaceCopy.frozen],
    ["publication-capability-missing", publicationSurfaceCopy.capabilityMissing]
  ] as const)("explains %s in the detail instead of attributing every restriction to permissions", async (blocker, message) => {
    renderSurface(false, { blockers: [blocker] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `查看 ${activeDefinition.propertyKey}` }));
    const dialog = await screen.findByRole("dialog", { name: `查看 ${activeDefinition.propertyKey}` });
    expect(within(dialog).getByText(message)).toBeVisible();
    expect(within(dialog).queryByText("如需编辑参数定义，请联系组织管理员开通参数目录编写权限。")).not.toBeInTheDocument();
  });
  it("preserves a real definition draft on cancelled dismissal and discards it only after confirmation", async () => {
    renderSurface(true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `编辑 ${activeDefinition.propertyKey}` }));
    const displayName = screen.getByRole("textbox", { name: "显示名" });
    await user.clear(displayName);
    await user.type(displayName, "待保存的显示名称");
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("dialog", { name: "放弃未保存的修改？" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(displayName).toHaveValue("待保存的显示名称");
    await user.click(screen.getByRole("button", { name: "关闭" }));
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("keeps publication guidance between the toolbar and module navigator without a release strip", async () => {
    renderSurface(true);
    const notice = await screen.findByRole("region", { name: "发布状态" });
    const page = screen.getByRole("region", { name: "参数定义目录" });
    const toolbar = within(page).getByRole("group", { name: "工作台操作" });
    expect(within(page).queryByRole("region", { name: "目录发布" })).not.toBeInTheDocument();
    const navigator = within(page).getByRole("region", { name: "模块导航" });
    expect(page).toContainElement(notice);
    expect(toolbar.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(navigator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice).toHaveTextContent("可以保存草稿并预览，但发布需要 catalog:publish。");
  });

  it("shows the published name next to a monospace property key", async () => {
    renderSurface(false);
    const action = await screen.findByRole("button", { name: `查看 ${activeDefinition.propertyKey}` });
    const row = action.closest("tr")!;
    expect(within(row).getByText(activeDefinition.propertyKey, { selector: "code" })).toBeVisible();
    expect(within(row).getByText(activeDefinition.currentRevision.displayName!)).toBeVisible();
  });

  it.each(["user", "admin", "platform-admin", "operator"])(
    "scopes takeover instructions to the %s audience inside a disclosure", async (roleId) => {
      const ports = createMockCatalogPorts({ scenario: "ready" });
      const readSurface = ports.catalog.getPublicationSurface;
      vi.spyOn(ports.catalog, "getPublicationSurface").mockImplementation(async () => {
        const response = await readSurface();
        return { item: { ...response.item, adopted: false, authoringAllowed: false,
          publishingAllowed: false, blockers: ["catalog-not-adopted", "publication-not-authorized"] } };
      });
      render(<CatalogOrganizationSurface {...ports} actor="user"
        sessionRoles={[{ roleId, projectId: null }]} search="" currentPersonId="reader"
        onAnchorChange={vi.fn()} />);
      const banner = await screen.findByRole("region", { name: "发布状态" });
      const page = screen.getByRole("region", { name: "参数定义目录" });
      const toolbar = within(page).getByRole("group", { name: "工作台操作" });
      const navigator = within(page).getByRole("region", { name: "模块导航" });
      expect(page).toContainElement(banner);
      expect(toolbar.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(banner.compareDocumentPosition(navigator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(banner).getByText("参数目录尚未完成接管，暂不能编写或发布参数定义。")).toBeVisible();
      const disclosure = within(banner).getByText("了解详情").closest("details")!;
      expect(disclosure).not.toHaveAttribute("open");
      expect(banner.querySelector("p")).not.toHaveTextContent(/inspect|adopt/);
      await userEvent.click(within(banner).getByText("了解详情"));
      expect(disclosure).toHaveAttribute("open");
      if (roleId === "platform-admin" || roleId === "operator") {
        expect(disclosure).toHaveTextContent("接管完成后，还需启用发布策略并确认账号拥有相应权限。");
        expect(disclosure).toHaveTextContent("inspect/adopt");
      } else {
        expect(banner).not.toHaveTextContent(/inspect|adopt|操作员手册/);
      }
    }
  );
  it("offers viewing and explains the authoring grant when the server denies authoring", async () => {
    renderSurface(false);
    const user = userEvent.setup();
    const action = await screen.findByRole("button", { name: `查看 ${activeDefinition.propertyKey}` });
    expect(action).toHaveTextContent("查看");
    expect(action).toHaveAttribute("data-catalog-row-action", "read");
    expect(screen.queryByRole("button", { name: `编辑 ${activeDefinition.propertyKey}` })).not.toBeInTheDocument();
    await user.click(action);
    const dialog = await screen.findByRole("dialog", { name: `查看 ${activeDefinition.propertyKey}` });
    expect(within(dialog).getByRole("heading", { name: `查看 ${activeDefinition.propertyKey}` })).toBeVisible();
    expect(within(dialog).getAllByText("如需编辑参数定义，请联系组织管理员开通参数目录编写权限。")).toHaveLength(1);
    expect(dialog).not.toHaveTextContent("当前会话缺少目录编写能力");
    expect(dialog).not.toHaveTextContent("catalog:author");
    expect(dialog).not.toHaveTextContent("有效编写能力由服务端");
    expect(within(dialog).queryByRole("textbox", { name: "属性键" })).not.toBeInTheDocument();
    expect(within(dialog).getByText(activeDefinition.currentRevision.displayName)).toBeVisible();
    expect(within(dialog).getByText("整数")).toBeVisible();
    expect(within(dialog).getByText("us")).toBeVisible();
  });

  it("keeps editing available for an author even without publishing capability", async () => {
    renderSurface(true);
    const user = userEvent.setup();
    const action = await screen.findByRole("button", { name: `编辑 ${activeDefinition.propertyKey}` });
    expect(action).toHaveTextContent("编辑");
    expect(action).toHaveAttribute("data-catalog-row-action", "edit");
    expect(screen.queryByRole("button", { name: `查看 ${activeDefinition.propertyKey}` })).not.toBeInTheDocument();
    await user.click(action);
    const dialog = await screen.findByRole("dialog", { name: `编辑 ${activeDefinition.propertyKey}` });
    expect(within(dialog).getByRole("heading", { name: `编辑 ${activeDefinition.propertyKey}` })).toBeVisible();
    const propertyKey = within(dialog).getByRole("textbox", { name: "属性键" });
    expect(propertyKey).toHaveValue(activeDefinition.propertyKey);
    await user.clear(propertyKey);
    await user.type(propertyKey, "new-property-key");
    expect(propertyKey).toHaveValue("new-property-key");
    await user.clear(propertyKey);
    await user.type(propertyKey, activeDefinition.propertyKey);
    await user.type(within(dialog).getByRole("textbox", { name: "显示名" }), "更新");
    await user.type(within(dialog).getByRole("textbox", { name: "修改原因" }), "补充显示名");
    const save = within(dialog).getByRole("button", { name: "保存内容修订" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("title", "当前目录暂不允许发布，请查看发布状态说明。");
    expect(dialog).not.toHaveTextContent("当前会话缺少目录编写能力");
    expect(dialog).not.toHaveTextContent("请联系组织管理员");
  });
});
