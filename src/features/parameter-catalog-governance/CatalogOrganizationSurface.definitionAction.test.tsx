import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { activeDefinition } from "@/application/parameter-catalog/fixtures";
import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { CatalogOrganizationSurface } from "./CatalogOrganizationSurface";

function renderSurface(authoringAllowed: boolean) {
  const ports = createMockCatalogPorts({ scenario: "ready" });
  const readSurface = ports.catalog.getPublicationSurface;
  vi.spyOn(ports.catalog, "getPublicationSurface").mockImplementation(async () => {
    const response = await readSurface();
    return { item: { ...response.item, authoringAllowed, publishingAllowed: false } };
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
  it("keeps publication guidance between release context and the module navigator", async () => {
    renderSurface(true);
    const notice = await screen.findByRole("region", { name: "发布状态" });
    const page = screen.getByRole("region", { name: "参数定义目录" });
    const release = within(page).getByRole("region", { name: "目录发布" });
    const navigator = within(page).getByRole("region", { name: "模块导航" });
    expect(page).toContainElement(notice);
    expect(release.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
      const release = within(page).getByRole("region", { name: "目录发布" });
      const navigator = within(page).getByRole("region", { name: "模块导航" });
      expect(page).toContainElement(banner);
      expect(release.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(banner.compareDocumentPosition(navigator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(banner).getByText("参数目录正在接管中，部分管理操作暂不可用。")).toBeVisible();
      const disclosure = within(banner).getByText("了解详情").closest("details")!;
      expect(disclosure).not.toHaveAttribute("open");
      expect(banner.querySelector("p")).not.toHaveTextContent(/inspect|adopt/);
      await userEvent.click(within(banner).getByText("了解详情"));
      expect(disclosure).toHaveAttribute("open");
      if (roleId === "platform-admin" || roleId === "operator") {
        expect(disclosure).toHaveTextContent("由平台运维完成接管后即可使用。");
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
    expect(dialog).not.toHaveTextContent("当前会话缺少目录编写能力");
    expect(dialog).not.toHaveTextContent("请联系组织管理员");
  });
});
