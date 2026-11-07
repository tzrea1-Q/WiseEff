import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { catalogApiFailure } from "@/application/parameter-catalog/errors";
import { CATALOG_ORGANIZATION_ID, CATALOG_RELEASE_ID, catalogRegistration, readyCatalogDocument, registeredSubject } from "@/application/parameter-catalog/fixtures";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { CatalogRegistrationResponse, CatalogSubjectResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { selectControlOption } from "@/test/selectControlOption";
import { RegistrationOwnerDialog } from "./RegistrationOwnerDialog";

function setup() {
  const owner = { ...registeredSubject, id: "driver-a", canonicalName: "vendor,driver-a" };
  const target = { ...registeredSubject, id: "driver-b", canonicalName: "vendor,driver-b" };
  const child = { ...registeredSubject, id: "child", canonicalName: "battery", type: "node-type" as const, ownerSubjectId: owner.id };
  const sourceRegistration = { ...catalogRegistration, id: "child-registration", subjectId: child.id, ownerSubjectId: owner.id,
    impact: { bindingCount: 3, projectCount: 1 } };
  const targetRegistration = { ...catalogRegistration, id: "target-registration", subjectId: target.id };
  const getSubject = vi.fn<ParameterCatalogRepository["getSubject"]>(async id => ({ item: id === child.id ? child : id === owner.id ? owner : target }));
  const getRegistration = vi.fn<(organizationId: string, registrationId: string) => Promise<CatalogRegistrationResponse & { etag?: string }>>(
    async (_organizationId, id) => ({ item: id === sourceRegistration.id ? sourceRegistration : targetRegistration, etag: '"source-v1"' }));
  const listSubjects = vi.fn(async () => ({ items: [owner, target, { ...target, id: "unregistered-driver" },
    { ...target, id: "inactive-driver", membership: { ...target.membership, status: "retired" as const } }],
    totalCount: 4, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID }));
  const listRegistrations = vi.fn(async () => ({ items: [sourceRegistration, targetRegistration,
    { ...catalogRegistration, subjectId: owner.id }, { ...catalogRegistration, subjectId: "inactive-driver" }],
    totalCount: 4, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID }));
  const changeRegistrationOwner = vi.fn<ParameterCatalogGovernanceRepository["changeRegistrationOwner"]>(async () => ({ item: { ...sourceRegistration, ownerSubjectId: target.id } }));
  const props = { subject: child, registrationId: sourceRegistration.id, actor: "org-admin" as const,
    catalog: { getCatalog: vi.fn(async () => readyCatalogDocument), getSubject, listSubjects } as unknown as ParameterCatalogRepository,
    governance: { getRegistration, listRegistrations, changeRegistrationOwner } as unknown as ParameterCatalogGovernanceRepository,
    organizationId: CATALOG_ORGANIZATION_ID, onCompleted: vi.fn(), onClose: vi.fn() };
  return { props, child, owner, target, sourceRegistration, targetRegistration, getSubject, getRegistration, listSubjects,
    listRegistrations, changeRegistrationOwner };
}

async function chooseTargetAndReason() {
  await screen.findByText(/3 个参数绑定，涉及 1 个项目/);
  await selectControlOption(screen.getByRole("combobox", { name: "目标驱动" }), "driver-b");
  await userEvent.type(screen.getByRole("textbox", { name: "操作原因" }), "调整本组织节点归属");
}

describe("RegistrationOwnerDialog", () => {
  it("offers only active registered alternative drivers and requires acknowledgement before the conditional write", async () => {
    const ports = setup();
    render(<RegistrationOwnerDialog {...ports.props} />);
    await screen.findByText(/3 个参数绑定，涉及 1 个项目/);
    expect(screen.getByText(/仅调整本组织/)).toBeVisible();
    await userEvent.click(screen.getByRole("combobox", { name: "目标驱动" }));
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await userEvent.click(screen.getByRole("option", { name: "vendor,driver-b" }));
    await userEvent.type(screen.getByRole("textbox", { name: "操作原因" }), "调整本组织节点归属");
    expect(screen.getByRole("button", { name: "确认调整归属" })).toBeDisabled();
    expect(screen.getByText("当前驱动：vendor,driver-a → vendor,driver-b")).toBeVisible();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "确认调整归属" }));
    await waitFor(() => expect(ports.props.onCompleted).toHaveBeenCalledOnce());
    expect(ports.changeRegistrationOwner).toHaveBeenCalledExactlyOnceWith(CATALOG_ORGANIZATION_ID, "child-registration",
      { ownerSubjectId: "driver-b", reason: "调整本组织节点归属" },
      { catalogReleaseId: CATALOG_RELEASE_ID, ifMatch: '"source-v1"', idempotencyKey: expect.any(String) });
    expect(ports.getRegistration).toHaveBeenCalledWith(CATALOG_ORGANIZATION_ID, "target-registration");
  });

  it("excludes organization-only driver corrections from ownership targets", async () => {
    const ports = setup();
    ports.listSubjects.mockResolvedValue({ items: [ports.owner, { ...ports.target, canonicalType: "node-type" }],
      totalCount: 2, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID });
    render(<RegistrationOwnerDialog {...ports.props} />);
    await screen.findByText("没有其他已启用并登记的驱动。请先在本组织登记目标驱动。");
    expect(screen.getByRole("button", { name: "确认调整归属" })).toBeDisabled();
    expect(ports.changeRegistrationOwner).not.toHaveBeenCalled();
  });

  it("retains draft on conflict, refreshes evidence and requires acknowledgement again", async () => {
    const ports = setup();
    ports.changeRegistrationOwner.mockRejectedValueOnce(catalogApiFailure("revision-conflict"));
    render(<RegistrationOwnerDialog {...ports.props} />);
    await chooseTargetAndReason();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "确认调整归属" }));
    await screen.findByText(/登记或目录版本已变化/);
    expect(screen.getByRole("textbox", { name: "操作原因" })).toHaveValue("调整本组织节点归属");
    expect(screen.getByRole("button", { name: "确认调整归属" })).toBeDisabled();
    ports.getRegistration.mockResolvedValueOnce({ item: ports.sourceRegistration, etag: '"source-v2"' });
    await userEvent.click(screen.getByRole("button", { name: "刷新影响数据" }));
    await screen.findByText(/当前驱动：vendor,driver-a → vendor,driver-b/);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "确认调整归属" }));
    await waitFor(() => expect(ports.props.onCompleted).toHaveBeenCalledOnce());
    expect(ports.changeRegistrationOwner.mock.calls[1]?.[3]).toMatchObject({ ifMatch: '"source-v2"' });
  });

  it("can change an organization owner again when the named Catalog snapshot still carries the shared default owner", async () => {
    const ports = setup();
    const originalOwnerRegistration = { ...catalogRegistration, subjectId: ports.owner.id };
    ports.getRegistration.mockImplementation(async (_organizationId, id) => ({
      item: id === ports.sourceRegistration.id ? { ...ports.sourceRegistration, ownerSubjectId: ports.target.id } : originalOwnerRegistration,
      etag: '"source-v2"'
    }));
    render(<RegistrationOwnerDialog {...ports.props} subject={{ ...ports.child, ownerSubjectId: ports.target.id }} />);
    await screen.findByText(/当前驱动：vendor,driver-b/);
    await selectControlOption(screen.getByRole("combobox", { name: "目标驱动" }), "driver-a");
    await userEvent.type(screen.getByRole("textbox", { name: "操作原因" }), "再次调整本组织归属");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "确认调整归属" }));
    await waitFor(() => expect(ports.props.onCompleted).toHaveBeenCalledOnce());
    expect(ports.changeRegistrationOwner).toHaveBeenCalledWith(CATALOG_ORGANIZATION_ID, "child-registration",
      { ownerSubjectId: "driver-a", reason: "再次调整本组织归属" }, expect.objectContaining({ ifMatch: '"source-v2"' }));
  });

  it("does not submit if the selected driver is retired before confirmation", async () => {
    const ports = setup();
    render(<RegistrationOwnerDialog {...ports.props} />);
    await chooseTargetAndReason();
    ports.getRegistration.mockResolvedValueOnce({ item: { ...ports.targetRegistration, status: "retired" } });
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "确认调整归属" }));
    await screen.findByText("目标驱动已不可用，请刷新影响数据并重新选择。");
    expect(ports.changeRegistrationOwner).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "操作原因" })).toHaveValue("调整本组织节点归属");
  });

  it.each(["missing-version", "missing-impact", "wrong-organization", "retired-child", "inconsistent-placement", "user"])("fails closed for %s", async failure => {
    const ports = setup();
    if (failure === "missing-version") ports.getRegistration.mockResolvedValueOnce({ item: ports.sourceRegistration });
    if (failure === "missing-impact") ports.getRegistration.mockResolvedValueOnce({ item: { ...ports.sourceRegistration, impact: undefined }, etag: "v1" });
    if (failure === "wrong-organization") ports.getRegistration.mockResolvedValueOnce({ item: { ...ports.sourceRegistration, organizationId: "another-org" }, etag: "v1" });
    if (failure === "retired-child") ports.getSubject.mockResolvedValueOnce({ item: { ...ports.child,
      membership: { ...ports.child.membership, status: "retired" } } } as CatalogSubjectResponse);
    if (failure === "inconsistent-placement") ports.getSubject.mockResolvedValueOnce({ item: { ...ports.child,
      registration: { status: "active", id: ports.sourceRegistration.id, placement: { ...catalogRegistration.placement, ownerSubjectId: "changed-driver" } } } });
    render(<RegistrationOwnerDialog {...ports.props} actor={failure === "user" ? "user" : "org-admin"} />);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "确认调整归属" })).toBeDisabled();
    expect(ports.changeRegistrationOwner).not.toHaveBeenCalled();
  });

  it("keeps an empty target list actionable with registration guidance and confirms unsaved close", async () => {
    const ports = setup();
    ports.listSubjects.mockResolvedValue({ items: [ports.owner], totalCount: 1, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID });
    render(<RegistrationOwnerDialog {...ports.props} />);
    await screen.findByText("没有其他已启用并登记的驱动。请先在本组织登记目标驱动。");
    expect(screen.getByRole("button", { name: "确认调整归属" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "操作原因" }), "保留草稿");
    await userEvent.keyboard("{Escape}");
    await screen.findByRole("dialog", { name: "放弃未保存的归属调整？" });
    expect(ports.props.onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(ports.props.onClose).toHaveBeenCalledOnce();
  });

  it("guards an editor section change without submitting or closing the editor", async () => {
    const ports = setup();
    const changeSection = vi.fn();
    render(<RegistrationOwnerDialog {...ports.props} editor={{ title: "编辑节点：battery",
      renderNavigation: (requestLeave, busy) => <button type="button" disabled={busy} onClick={() => requestLeave(changeSection)}>识别规则</button> }} />);
    await chooseTargetAndReason();
    await userEvent.click(screen.getByRole("button", { name: "识别规则" }));
    await screen.findByRole("dialog", { name: "放弃未保存的归属调整？" });
    expect(changeSection).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByRole("textbox", { name: "操作原因" })).toHaveValue("调整本组织节点归属");
    await userEvent.click(screen.getByRole("button", { name: "识别规则" }));
    await userEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(changeSection).toHaveBeenCalledOnce();
    expect(ports.props.onClose).not.toHaveBeenCalled();
    expect(ports.changeRegistrationOwner).not.toHaveBeenCalled();
  });
});
