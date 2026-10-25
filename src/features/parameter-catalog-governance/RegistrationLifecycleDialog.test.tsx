import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { catalogApiFailure } from "@/application/parameter-catalog/errors";
import { CATALOG_ORGANIZATION_ID, CATALOG_RELEASE_ID, catalogRegistration, readyCatalogDocument, registeredSubject } from "@/application/parameter-catalog/fixtures";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import { RegistrationLifecycleDialog } from "./RegistrationLifecycleDialog";

function setup(restoring = false) {
  const getRegistration = vi.fn(async () => ({ item: { ...catalogRegistration,
    status: restoring ? "retired" as const : "active" as const,
    impact: { bindingCount: 3, projectCount: 1, projects: [{ id: "project-a", name: "引用项目", bindingCount: 3 }] }
  }, etag: '"registration-v1"' }));
  const getSubject = vi.fn(async () => ({ item: registeredSubject }));
  const retireRegistration = vi.fn<ParameterCatalogGovernanceRepository["retireRegistration"]>(async () => ({ item: { ...catalogRegistration, status: "retired" as const } }));
  const restoreRegistration = vi.fn<ParameterCatalogGovernanceRepository["restoreRegistration"]>(async () => ({ item: catalogRegistration }));
  const createRegistration = vi.fn<ParameterCatalogGovernanceRepository["createRegistration"]>(async () => ({ item: { ...catalogRegistration,
    status: "retired", placement: { ...catalogRegistration.placement, moduleId: undefined } } }));
  const onCompleted = vi.fn();
  const onClose = vi.fn();
  const props = { intent: restoring ? "restore-registration" as const : "retire-registration" as const,
    subject: registeredSubject, registrationId: catalogRegistration.id, actor: "org-admin" as const,
    catalog: { getCatalog: vi.fn(async () => readyCatalogDocument), getSubject } as unknown as ParameterCatalogRepository,
    governance: { getRegistration, retireRegistration, restoreRegistration, createRegistration } as unknown as ParameterCatalogGovernanceRepository,
    organizationId: CATALOG_ORGANIZATION_ID, modules: [], onCompleted, onClose };
  return { props, getRegistration, getSubject, retireRegistration, restoreRegistration, createRegistration, onCompleted, onClose };
}

describe("RegistrationLifecycleDialog", () => {
  it.each([0, 3])("removes an unregistered subject with %s definitions only after organization-scoped confirmation", async (count) => {
    const ports = setup();
    ports.getSubject.mockResolvedValue({ item: { ...registeredSubject, registration: { status: "unregistered" },
      definitionCounts: { active: count, deprecated: 0, retired: 0 } } });
    render(<RegistrationLifecycleDialog {...ports.props} registrationId={undefined} />);
    await screen.findByText(`本组织尚未登记此主体，目录中有 ${count} 个有效定义。`);
    expect(screen.getByText(/平台共享定义及其他组织的登记不受影响/)).toBeVisible();
    expect(ports.getRegistration).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "操作原因" }), "本组织不再使用");
    expect(screen.getByRole("button", { name: "确认移除" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(ports.onCompleted).toHaveBeenCalledOnce());
    expect(ports.createRegistration).toHaveBeenCalledExactlyOnceWith(CATALOG_ORGANIZATION_ID,
      { subjectId: registeredSubject.id, status: "retired", placement: { mode: "use-default" }, reason: "本组织不再使用" },
      { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: expect.any(String) });
    expect(ports.retireRegistration).not.toHaveBeenCalled();
  });

  it("refuses a newly registered subject instead of retiring it from an unregistered preview", async () => {
    const ports = setup();
    render(<RegistrationLifecycleDialog {...ports.props} registrationId={undefined} />);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "确认移除" })).toBeDisabled();
    expect(ports.createRegistration).not.toHaveBeenCalled();
    expect(ports.retireRegistration).not.toHaveBeenCalled();
  });

  it("preserves an unregistered removal reason after a conflict and refuses a concurrent registration on refresh", async () => {
    const ports = setup();
    ports.getSubject.mockResolvedValueOnce({ item: { ...registeredSubject, registration: { status: "unregistered" } } });
    ports.createRegistration.mockRejectedValueOnce(catalogApiFailure("revision-conflict"));
    render(<RegistrationLifecycleDialog {...ports.props} registrationId={undefined} />);
    await screen.findByText(/本组织尚未登记此主体/);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "操作原因" }), "保留移除原因");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "确认移除" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "刷新影响数据" }));
    await screen.findByText("登记或目录状态已变化，请关闭弹窗并刷新列表。");
    expect(screen.getByRole("textbox", { name: "操作原因" })).toHaveValue("保留移除原因");
    expect(screen.getByRole("button", { name: "确认移除" })).toBeDisabled();
    expect(ports.createRegistration).toHaveBeenCalledOnce();
    expect(ports.retireRegistration).not.toHaveBeenCalled();
  });

  it("requires current impact, a reason and acknowledgement before a conditional organization removal", async () => {
    const ports = setup();
    const user = userEvent.setup();
    render(<RegistrationLifecycleDialog {...ports.props} />);
    await screen.findByText(/3 个参数绑定，涉及 1 个项目/);
    expect(screen.getByRole("button", { name: "确认移除" })).toBeDisabled();
    await user.click(screen.getByText("查看受影响项目"));
    expect(screen.getByRole("link", { name: "引用项目" })).toHaveAttribute("href", "/parameters?project=project-a");
    await user.type(screen.getByRole("textbox", { name: "操作原因" }), " 不再使用此驱动 ");
    expect(screen.getByRole("button", { name: "确认移除" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(ports.onCompleted).toHaveBeenCalledOnce());
    expect(ports.retireRegistration).toHaveBeenCalledExactlyOnceWith(CATALOG_ORGANIZATION_ID, catalogRegistration.id,
      { reason: "不再使用此驱动" }, { catalogReleaseId: CATALOG_RELEASE_ID, ifMatch: '"registration-v1"', idempotencyKey: expect.any(String) });
    expect(ports.restoreRegistration).not.toHaveBeenCalled();
  });

  it("preserves the reason after a conflict and requires refreshed evidence and a new acknowledgement", async () => {
    const ports = setup();
    ports.retireRegistration.mockRejectedValueOnce(catalogApiFailure("revision-conflict"));
    const user = userEvent.setup();
    render(<RegistrationLifecycleDialog {...ports.props} />);
    await screen.findByText(/3 个参数绑定，涉及 1 个项目/);
    await user.type(screen.getByRole("textbox", { name: "操作原因" }), "保留我的输入");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "确认移除" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("textbox", { name: "操作原因" })).toHaveValue("保留我的输入");
    expect(screen.getByRole("button", { name: "确认移除" })).toBeDisabled();
    ports.getRegistration.mockResolvedValueOnce({ ...(await ports.getRegistration()), etag: '"registration-v2"' });
    await user.click(screen.getByRole("button", { name: "刷新影响数据" }));
    await screen.findByText(/3 个参数绑定，涉及 1 个项目/);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(ports.onCompleted).toHaveBeenCalledOnce());
    expect(ports.retireRegistration.mock.calls[1]?.[3]).toMatchObject({ ifMatch: '"registration-v2"' });
  });

  it("restores the same registration with an explicit unset warning when its module is gone", async () => {
    const ports = setup(true);
    const user = userEvent.setup();
    render(<RegistrationLifecycleDialog {...ports.props} />);
    await screen.findByText(/原模块已删除或归属未设置/);
    await user.type(screen.getByRole("textbox", { name: "操作原因" }), "重新启用");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "确认恢复" }));
    await waitFor(() => expect(ports.restoreRegistration).toHaveBeenCalledOnce());
    expect(ports.restoreRegistration.mock.calls[0]?.[1]).toBe(catalogRegistration.id);
  });

  it.each(["missing-version", "missing-impact", "retired-subject", "user"])("fails closed for %s", async (failure) => {
    const ports = setup(failure === "retired-subject");
    if (failure === "missing-version") ports.getRegistration.mockResolvedValueOnce({ ...(await ports.getRegistration()), etag: "" });
    if (failure === "missing-impact") ports.getRegistration.mockResolvedValueOnce({ item: { ...catalogRegistration, impact: undefined }, etag: "v1" } as unknown as Awaited<ReturnType<typeof ports.getRegistration>>);
    if (failure === "retired-subject") ports.getSubject.mockResolvedValueOnce({ item: { ...registeredSubject, membership: { ...registeredSubject.membership, status: "retired" } } });
    render(<RegistrationLifecycleDialog {...ports.props} actor={failure === "user" ? "user" : "org-admin"} />);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: /^确认/ })).toBeDisabled();
    expect(ports.retireRegistration).not.toHaveBeenCalled();
    expect(ports.restoreRegistration).not.toHaveBeenCalled();
  });
});
