import { selectControlOption } from "@/test/selectControlOption";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CATALOG_ORGANIZATION_ID,
  CATALOG_PLACEMENT_ID,
  CATALOG_REGISTRATION_ID,
  CATALOG_RELEASE_ID,
  CATALOG_REVIEW_ITEM_ID,
  CATALOG_SUBJECT_ID,
  catalogRegistration,
  readyCatalogDocument,
  unregisteredSubject
} from "@/application/parameter-catalog/fixtures";
import { catalogApiFailure } from "@/application/parameter-catalog/errors";
import { createMockCatalogPorts, createMockParameterCatalogGovernanceRepository } from "@/application/parameter-catalog/mockAdapter";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import type { CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";

import { RegistrationDialog } from "./RegistrationDialog";
import { createGovernanceIdempotencyKey } from "./governanceState";
import { CatalogOrganizationSurface } from "./CatalogOrganizationSurface";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";

const unregistered = deriveCatalogDomainState({
  document: readyCatalogDocument,
  subject: unregisteredSubject
});
const ready = deriveCatalogDomainState({ document: readyCatalogDocument });

function renderDialog(options: {
  actor?: CatalogActorKind;
  domainState?: CatalogDomainState;
  intent?: "register-subject" | "update-placement";
  repository?: ParameterCatalogGovernanceRepository;
  catalogReleaseId?: string;
  ifMatch?: string;
  moduleOptions?: { id: string; displayName: string; kind?: string }[];
  newDestinationParents?: { id: string; displayName: string }[];
  initialDestinationModuleId?: string;
  createIdempotencyKey?: () => string;
  onRefreshEvidence?: () => void;
  onCompleted?: () => void;
} = {}) {
  const repository =
    options.repository ??
    createMockParameterCatalogGovernanceRepository({ scenario: "unregistered" });
  const createRegistration = vi.spyOn(repository, "createRegistration");
  const updatePlacement = vi.spyOn(repository, "updatePlacement");
  const onOpenChange = vi.fn();
  const view = render(
    <RegistrationDialog
      open
      intent={options.intent ?? "register-subject"}
      actor={options.actor ?? "org-admin"}
      domainState={options.domainState ?? unregistered}
      repository={repository}
      organizationId={CATALOG_ORGANIZATION_ID}
      subjectId={CATALOG_SUBJECT_ID}
      catalogReleaseId={options.catalogReleaseId ?? CATALOG_RELEASE_ID}
      registrationId={CATALOG_REGISTRATION_ID}
      ifMatch={options.ifMatch}
      placementOptions={[{ id: CATALOG_PLACEMENT_ID, displayName: "根放置" }]}
      moduleOptions={options.moduleOptions}
      newDestinationParents={options.newDestinationParents}
      initialDestinationModuleId={options.initialDestinationModuleId}
      createIdempotencyKey={options.createIdempotencyKey ?? (() => "key-reg")}
      onOpenChange={onOpenChange}
      onCompleted={options.onCompleted}
      onRefreshEvidence={options.onRefreshEvidence}
    />
  );
  return { ...view, repository, createRegistration, updatePlacement, onOpenChange };
}

async function confirmWrite(confirmName: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "继续确认" }));
  const confirm = await screen.findByRole("dialog", { name: /确认/ });
  await user.click(within(confirm).getByRole("checkbox"));
  await user.click(within(confirm).getByRole("button", { name: confirmName }));
  return user;
}

describe("RegistrationDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("confirms the selected placement once on HTTP without randomUUID and retains write preconditions", async () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const repository = createMockParameterCatalogGovernanceRepository();
    const onCompleted = vi.fn();
    const { updatePlacement } = renderDialog({
      repository, domainState: ready, intent: "update-placement", ifMatch: "etag-reg",
      moduleOptions: [{ id: "source", displayName: "原模块" }, { id: "target", displayName: "目标模块" }],
      initialDestinationModuleId: "source", createIdempotencyKey: createGovernanceIdempotencyKey, onCompleted
    });
    let release!: (value: Awaited<ReturnType<ParameterCatalogGovernanceRepository["updatePlacement"]>>) => void;
    updatePlacement.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    await selectControlOption(screen.getByLabelText("目标模块"), "target");
    await user.click(screen.getByRole("button", { name: "继续确认" }));
    const confirmation = screen.getByRole("dialog", { name: "确认调整放置" });
    const confirm = within(confirmation).getByRole("button", { name: "确认调整放置" });
    expect(confirm).toBeDisabled();
    await user.click(within(confirmation).getByRole("checkbox"));
    // Deliver both clicks before React commits pending, exercising the gate's
    // synchronous protection as well as the rendered disabled state.
    act(() => { confirm.click(); confirm.click(); });

    expect(updatePlacement).toHaveBeenCalledExactlyOnceWith(
      CATALOG_ORGANIZATION_ID, CATALOG_REGISTRATION_ID,
      { placement: { mode: "use-default" }, destinationModuleId: "target" },
      { catalogReleaseId: CATALOG_RELEASE_ID, ifMatch: "etag-reg",
        idempotencyKey: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/) }
    );
    expect(within(confirmation).getByRole("button", { name: "处理中…" })).toBeDisabled();
    await act(async () => { release({ item: catalogRegistration.placement }); });
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows preparation failures without writing, retains the target and permits an explicitly reconfirmed retry", async () => {
    const createIdempotencyKey = vi.fn()
      .mockImplementationOnce(() => { throw new Error("secure random source failed"); })
      .mockReturnValue("retry-key");
    const { updatePlacement } = renderDialog({
      repository: createMockParameterCatalogGovernanceRepository(), domainState: ready,
      intent: "update-placement", ifMatch: "etag-reg", createIdempotencyKey,
      moduleOptions: [{ id: "source", displayName: "原模块" }, { id: "target", displayName: "目标模块" }],
      initialDestinationModuleId: "source"
    });
    await selectControlOption(screen.getByLabelText("目标模块"), "target");
    await confirmWrite("确认调整放置");

    expect(await screen.findByRole("alert")).toHaveTextContent("目录写入失败，请稍后重试。");
    expect(updatePlacement).not.toHaveBeenCalled();
    expect(createIdempotencyKey).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("目标模块")).toHaveAttribute("data-value", "target");
    expect(screen.queryByRole("dialog", { name: "确认调整放置" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "继续确认" })).toBeEnabled();

    await confirmWrite("确认调整放置");
    await waitFor(() => expect(updatePlacement).toHaveBeenCalledOnce());
    expect(updatePlacement.mock.calls[0]?.[3]).toEqual({
      catalogReleaseId: CATALOG_RELEASE_ID, ifMatch: "etag-reg", idempotencyKey: "retry-key"
    });
  });

  it("initializes a typed destination only after an explicit business parent, name and confirmation", async () => {
    const { createRegistration } = renderDialog({ newDestinationParents: [{ id: "parent-business", displayName: "电源 / 充电" }] });
    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: "继续确认" })).toBeDisabled();
    await selectControlOption(screen.getByLabelText("新模块业务分类"), "parent-business");
    await user.type(screen.getByLabelText("新模块名称"), "充电驱动");
    await user.click(screen.getByRole("button", { name: "继续确认" }));
    const confirm = screen.getByRole("dialog", { name: "确认登记主体" });
    expect(confirm).toHaveTextContent("电源 / 充电 / 充电驱动");
    await user.click(within(confirm).getByRole("checkbox"));
    await user.click(within(confirm).getByRole("button", { name: "确认登记" }));
    await waitFor(() => expect(createRegistration).toHaveBeenCalled());
    expect(createRegistration.mock.calls[0][1]).toMatchObject({ newDestination: { parentModuleId: "parent-business", name: "充电驱动" } });
    expect(createRegistration.mock.calls[0][1]).not.toHaveProperty("destinationModuleId");
  });

  it("guards dirty dismissal and SPA navigation without discarding the selected target", async () => {
    const { onOpenChange } = renderDialog({ moduleOptions: [{ id: "target", displayName: "电源 / 驱动" }] });
    const user = userEvent.setup();
    await selectControlOption(screen.getByLabelText("目标模块"), "target");
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("目标模块")).toHaveAttribute("data-value", "target");
    expect(onOpenChange).not.toHaveBeenCalled();
    let decision: boolean | Promise<boolean> = false;
    act(() => { decision = requestSettingsLeave(); });
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(await decision).toBe(false);
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it("opens the exact Review Item when the module discovery link carries its ID", async () => {
    const ports = createMockCatalogPorts();
    const read = vi.spyOn(ports.governance, "getReviewItem");
    render(<CatalogOrganizationSurface {...ports} actor="org-admin"
      search={`?reviewItemId=${CATALOG_REVIEW_ITEM_ID}`}
      onAnchorChange={vi.fn()} organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="person-admin" />);
    expect(await screen.findByRole("dialog", { name: "处理审核" })).toBeVisible();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(read).toHaveBeenCalledWith(CATALOG_ORGANIZATION_ID, CATALOG_REVIEW_ITEM_ID);
  });
  it("refreshes the organization surface after first registration succeeds", async () => {
    const ports = createMockCatalogPorts({ scenario: "unregistered" });
    const read = vi.spyOn(ports.catalog, "getCatalog");
    render(<CatalogOrganizationSurface {...ports} actor="org-admin"
      search={`?subjectId=${CATALOG_SUBJECT_ID}&catalogReleaseId=${CATALOG_RELEASE_ID}`}
      onAnchorChange={vi.fn()} organizationId={CATALOG_ORGANIZATION_ID} currentPersonId="person-admin" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "登记主体" }));
    await user.click(screen.getByRole("radio", { name: "使用默认根放置" }));
    await user.type(screen.getByLabelText("原因"), "首次登记");
    const before = read.mock.calls.length;
    await confirmWrite("确认登记");
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before));
    expect(await screen.findByRole("button", { name: "调整放置" })).toBeVisible();
  });

  it("lets Org Admin choose default-root Placement, reconfirm, and register once with release and idempotency", async () => {
    const onCompleted = vi.fn();
    const { createRegistration } = renderDialog({ onCompleted });

    expect(screen.getByRole("dialog", { name: "登记主体" })).toBeVisible();
    await userEvent.setup().click(screen.getByRole("radio", { name: "使用默认根放置" }));
    await userEvent.setup().type(screen.getByLabelText("原因"), "纳入现行主体");
    await confirmWrite("确认登记");

    await waitFor(() => expect(createRegistration).toHaveBeenCalledTimes(1));
    expect(createRegistration).toHaveBeenCalledWith(
      CATALOG_ORGANIZATION_ID,
      {
        subjectId: CATALOG_SUBJECT_ID,
        placement: { mode: "use-default" },
        reason: "纳入现行主体"
      },
      { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: "key-reg" }
    );
    expect(createRegistration.mock.calls[0]?.[2]).not.toHaveProperty("ifMatch");
    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1));
  });

  it("requires and forwards the explicitly selected canonical destination module", async () => {
    const { createRegistration } = renderDialog({
      moduleOptions: [{ id: "issue897-driver-a", displayName: "Driver A", kind: "driver-group" }]
    });
    const user = userEvent.setup();

    expect(screen.queryByText("放置方式")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "使用默认根放置" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "继续确认" })).toBeDisabled();
    await selectControlOption(screen.getByLabelText("目标模块"), "issue897-driver-a");
    await user.click(screen.getByRole("button", { name: "继续确认" }));
    const confirm = await screen.findByRole("dialog", { name: "确认登记主体" });
    expect(confirm).toHaveTextContent("目标模块：Driver A");
    await user.click(within(confirm).getByRole("checkbox"));
    await user.click(within(confirm).getByRole("button", { name: "确认登记" }));

    await waitFor(() => expect(createRegistration).toHaveBeenCalledTimes(1));
    expect(createRegistration.mock.calls[0]?.[1]).toMatchObject({
      subjectId: CATALOG_SUBJECT_ID,
      placement: { mode: "use-default" },
      destinationModuleId: "issue897-driver-a"
    });
  });

  it("requires an explicit parent Placement choice before registration", async () => {
    const { createRegistration } = renderDialog();
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "选择父放置" }));
    await selectControlOption(screen.getByLabelText("父放置"), CATALOG_PLACEMENT_ID);
    await user.clear(screen.getByLabelText("放置显示名"));
    await user.type(screen.getByLabelText("放置显示名"), "充电芯片");
    await user.type(screen.getByLabelText("原因"), "挂到根下");
    await confirmWrite("确认登记");

    await waitFor(() => expect(createRegistration).toHaveBeenCalledTimes(1));
    expect(createRegistration).toHaveBeenCalledWith(
      CATALOG_ORGANIZATION_ID,
      {
        subjectId: CATALOG_SUBJECT_ID,
        placement: {
          mode: "choose-parent",
          parentPlacementId: CATALOG_PLACEMENT_ID,
          displayName: "充电芯片"
        },
        reason: "挂到根下"
      },
      { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: "key-reg" }
    );
  });

  it("refuses Agent and User writes while allowing Platform Admin registration management", async () => {
    const { unmount, createRegistration } = renderDialog({ actor: "agent" });
    expect(screen.getByText(/仅可阅读/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "继续确认" })).not.toBeInTheDocument();
    expect(createRegistration).not.toHaveBeenCalled();
    unmount();

    const userView = renderDialog({ actor: "user" });
    expect(userView.createRegistration).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "继续确认" })).not.toBeInTheDocument();
    userView.unmount();

    renderDialog({ actor: "platform-admin" });
    expect(screen.getByRole("button", { name: "继续确认" })).toBeVisible();
  });

  it("preserves Placement and reason on conflict and does not silently retry", async () => {
    const repository = createMockParameterCatalogGovernanceRepository({ scenario: "unregistered" });
    const createRegistration = vi
      .spyOn(repository, "createRegistration")
      .mockRejectedValue(catalogApiFailure("release-drift", { catalogReleaseId: CATALOG_RELEASE_ID }));
    renderDialog({ repository });

    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "选择父放置" }));
    await selectControlOption(screen.getByLabelText("父放置"), CATALOG_PLACEMENT_ID);
    await user.clear(screen.getByLabelText("放置显示名"));
    await user.type(screen.getByLabelText("放置显示名"), "充电芯片");
    await user.type(screen.getByLabelText("原因"), "保留这份输入");
    await confirmWrite("确认登记");

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveAttribute("data-preserve-input", "true");
    expect(banner).toHaveAttribute("data-silent-retry", "false");
    expect(banner).toHaveTextContent("输入已保留");
    expect(screen.getByLabelText("原因")).toHaveValue("保留这份输入");
    expect(screen.getByRole("radio", { name: "选择父放置" })).toBeChecked();
    expect(screen.getByLabelText("放置显示名")).toHaveValue("充电芯片");
    expect(createRegistration).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createRegistration).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "确认登记主体" })).not.toBeInTheDocument();
  });

  it("does not start a second Registration command while the first confirmation is pending", async () => {
    const repository = createMockParameterCatalogGovernanceRepository({ scenario: "unregistered" });
    let release!: (value: Awaited<ReturnType<ParameterCatalogGovernanceRepository["createRegistration"]>>) => void;
    const createRegistration = vi.spyOn(repository, "createRegistration").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    renderDialog({ repository });
    await userEvent.setup().click(screen.getByRole("radio", { name: "使用默认根放置" }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "继续确认" }));
    const confirm = await screen.findByRole("dialog", { name: "确认登记主体" });
    await user.click(within(confirm).getByRole("checkbox"));
    await user.click(within(confirm).getByRole("button", { name: "确认登记" }));
    expect(await screen.findByRole("button", { name: "处理中…" })).toBeDisabled();
    expect(createRegistration).toHaveBeenCalledTimes(1);
    release({ item: { ...catalogRegistration, id: CATALOG_REGISTRATION_ID } });
  });

  it("updates Placement with If-Match and does not infer a parent", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    const { updatePlacement, createRegistration } = renderDialog({
      actor: "org-admin",
      domainState: ready,
      intent: "update-placement",
      repository,
      ifMatch: "etag-reg"
    });
    const user = userEvent.setup();
    expect(screen.getByRole("dialog", { name: "调整放置" })).toBeVisible();
    await user.click(screen.getByRole("radio", { name: "使用默认根放置" }));
    await confirmWrite("确认调整放置");
    await waitFor(() => expect(updatePlacement).toHaveBeenCalledTimes(1));
    expect(updatePlacement).toHaveBeenCalledWith(
      CATALOG_ORGANIZATION_ID,
      CATALOG_REGISTRATION_ID,
      { placement: { mode: "use-default" } },
      {
        catalogReleaseId: CATALOG_RELEASE_ID,
        idempotencyKey: "key-reg",
        ifMatch: "etag-reg"
      }
    );
    expect(createRegistration).not.toHaveBeenCalled();
  });
});
