import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { CATALOG_ORGANIZATION_ID, CATALOG_RELEASE_ID, unregisteredSubject } from "@/application/parameter-catalog/fixtures";
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

it("hands newly published subjects and placement hints to batch registration", async () => {
  const ports = createMockCatalogPorts({ publicationOutcome: "active" });
  ports.catalog.previewMarkdownImport = async (_, context) => {
    const result = await ports.catalog.createPublicationCandidate({ changeSet: [{ op: "create-subject-with-definitions",
      kind: "driver", canonicalKey: "driver:acme,new", selector: { kind: "driver-compatible", value: "acme,new" },
      nature: "physical-device", cardinality: "multiple", definitions: [{ propertyKey: "one", content: {
        displayName: "参数", documentation: "", valueSchema: { type: "integer" },
      } }] }] }, context);
    return { item: { candidate: result.item, noChange: false, entries: [], source: { fileName: "d.md", sha256: "sha256:test", parserVersion: "v1" },
      placementHints: [{ kind: "driver", selector: "acme,new", categoryPath: "电源", moduleName: "充电芯片", line: 2, warnings: [] }] } };
  };
  vi.spyOn(ports.catalog, "getSubject").mockImplementation(async (id) => ({ item: { ...unregisteredSubject, id, canonicalName: "driver:acme,new", registration: { status: "unregistered" } } }));
  vi.spyOn(ports.governance, "listUnregisteredSubjects").mockResolvedValue({ catalogReleaseId: CATALOG_RELEASE_ID,
    items: [{ id: "csub_new_1", kind: "driver", canonicalName: "driver:acme,new", availableModuleIds: [] }],
    modules: [{ id: "category", name: "电源", parentId: null, kind: "business", occupied: false }] });
  render(<CatalogOrganizationSurface {...ports} runtimeMode="api" actor="org-admin" sessionPermissions={["catalog:author", "catalog:publish", "catalog:register"]}
    search="" organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="admin" onAnchorChange={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "批量导入定义" }));
  await user.type(screen.getByLabelText("Markdown 文档"), "文档");
  await user.click(screen.getByRole("button", { name: "解析并预览" }));
  await screen.findByLabelText("发布预览");
  await user.click(screen.getByRole("button", { name: "发布到目录" }));
  const confirmation = await screen.findByRole("dialog", { name: /确认/ });
  await user.click(within(confirmation).getByRole("checkbox"));
  await user.click(within(confirmation).getByRole("button", { name: "确认发布" }));
  await user.click(await screen.findByRole("button", { name: "前往批量登记" }));
  expect(await screen.findByLabelText("driver:acme,new 的模块名称")).toHaveValue("充电芯片");
  expect(screen.getByRole("checkbox", { name: "选择 driver:acme,new" })).toBeChecked();
});
