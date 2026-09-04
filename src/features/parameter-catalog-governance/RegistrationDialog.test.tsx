import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CATALOG_ORGANIZATION_ID,
  CATALOG_PLACEMENT_ID,
  CATALOG_REGISTRATION_ID,
  CATALOG_RELEASE_ID,
  CATALOG_SUBJECT_ID,
  readyCatalogDocument,
  unregisteredSubject
} from "@/application/parameter-catalog/fixtures";
import { catalogApiFailure } from "@/application/parameter-catalog/errors";
import { createMockParameterCatalogGovernanceRepository } from "@/application/parameter-catalog/mockAdapter";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import type { CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";

import { RegistrationDialog } from "./RegistrationDialog";

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
  createIdempotencyKey?: () => string;
  onRefreshEvidence?: () => void;
  onCompleted?: () => void;
} = {}) {
  const repository =
    options.repository ??
    createMockParameterCatalogGovernanceRepository({ scenario: "unregistered" });
  const createRegistration = vi.spyOn(repository, "createRegistration");
  const updatePlacement = vi.spyOn(repository, "updatePlacement");
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
      createIdempotencyKey={options.createIdempotencyKey ?? (() => "key-reg")}
      onOpenChange={vi.fn()}
      onCompleted={options.onCompleted}
      onRefreshEvidence={options.onRefreshEvidence}
    />
  );
  return { ...view, repository, createRegistration, updatePlacement };
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

  it("requires an explicit parent Placement choice before registration", async () => {
    const { createRegistration } = renderDialog();
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "选择父放置" }));
    await user.selectOptions(screen.getByLabelText("父放置"), CATALOG_PLACEMENT_ID);
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

  it("refuses Agent, User, and Platform Admin mutating registration", async () => {
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
    expect(screen.queryByRole("button", { name: "继续确认" })).not.toBeInTheDocument();
  });

  it("preserves Placement and reason on conflict and does not silently retry", async () => {
    const repository = createMockParameterCatalogGovernanceRepository({ scenario: "unregistered" });
    const createRegistration = vi
      .spyOn(repository, "createRegistration")
      .mockRejectedValue(catalogApiFailure("release-drift", { catalogReleaseId: CATALOG_RELEASE_ID }));
    renderDialog({ repository });

    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "选择父放置" }));
    await user.selectOptions(screen.getByLabelText("父放置"), CATALOG_PLACEMENT_ID);
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
    let release!: (value: unknown) => void;
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
    release({ item: { id: CATALOG_REGISTRATION_ID } });
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
