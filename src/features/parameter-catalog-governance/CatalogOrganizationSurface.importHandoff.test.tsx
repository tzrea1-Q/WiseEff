import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { CATALOG_ORGANIZATION_ID } from "@/application/parameter-catalog/fixtures";
import { dispatchDefinitionImportHandoff } from "@/features/agent/definitionImportHandoff";
import { CatalogOrganizationSurface } from "./CatalogOrganizationSurface";

it("opens the pending handoff only after the authorized catalog surface is ready", async () => {
  const ports = createMockCatalogPorts({ scenario: "ready" });
  const preview = vi.spyOn(ports.catalog, "previewMarkdownImport");
  const publish = vi.spyOn(ports.catalog, "publishPublicationCandidate");
  dispatchDefinitionImportHandoff({ organizationId: CATALOG_ORGANIZATION_ID, userId: "admin", document: "准备好的文档" });
  render(<CatalogOrganizationSurface {...ports} actor="org-admin" sessionPermissions={["catalog:author"]}
    search="" organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="admin" onAnchorChange={vi.fn()} />);
  const dialog = await screen.findByRole("dialog", { name: "批量导入定义" });
  expect(within(dialog).getByLabelText("Markdown 文档")).toHaveValue("准备好的文档");
  expect(preview).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});

it("does not open or prefill for a user without author permission", async () => {
  const ports = createMockCatalogPorts({ scenario: "ready" });
  const view = render(<CatalogOrganizationSurface {...ports} actor="user" sessionPermissions={[]}
    search="" organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="reader" onAnchorChange={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("region", { name: "参数定义目录" })).toHaveAttribute("data-catalog-state", "ready"));
  await act(async () => dispatchDefinitionImportHandoff({ organizationId: CATALOG_ORGANIZATION_ID, userId: "reader", document: "不应打开" }));
  expect(screen.queryByRole("dialog", { name: "批量导入定义" })).not.toBeInTheDocument();
  view.unmount();
});

it("preserves an open draft and delivers a later handoff after the human closes it", async () => {
  const ports = createMockCatalogPorts({ scenario: "ready" });
  render(<CatalogOrganizationSurface {...ports} actor="org-admin" sessionPermissions={["catalog:author"]}
    search="" organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="admin" onAnchorChange={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "批量导入定义" }));
  const input = screen.getByLabelText("Markdown 文档");
  await userEvent.type(input, "原有草稿");
  await act(async () => dispatchDefinitionImportHandoff({ organizationId: CATALOG_ORGANIZATION_ID, userId: "admin", document: "新文档" }));
  expect(input).toHaveValue("原有草稿");
  await userEvent.keyboard("{Escape}");
  await userEvent.click(within(await screen.findByRole("dialog", { name: "离开未保存的编写" })).getByRole("button", { name: "离开" }));
  expect(await screen.findByLabelText("Markdown 文档")).toHaveValue("新文档");
});
