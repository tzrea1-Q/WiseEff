import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CATALOG_AUTHOR_PERSON_ID,
  CATALOG_DEFINITION_ID,
  CATALOG_PROPOSAL_ID,
  CATALOG_RELEASE_ID,
  CATALOG_REVIEWER_PERSON_ID,
  CATALOG_REVISION_ID,
  catalogProposal,
  readyCatalogDocument
} from "@/application/parameter-catalog/fixtures";
import { catalogApiFailure } from "@/application/parameter-catalog/errors";
import { createMockParameterCatalogGovernanceRepository } from "@/application/parameter-catalog/mockAdapter";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import type { CatalogActorKind } from "@/application/parameter-catalog/authority";

import { ProposalPanel } from "./ProposalPanel";

const ready = deriveCatalogDomainState({ document: readyCatalogDocument });

function renderPanel(options: {
  actor?: CatalogActorKind;
  currentPersonId?: string;
  repository?: ReturnType<typeof createMockParameterCatalogGovernanceRepository>;
  createIdempotencyKey?: () => string;
} = {}) {
  const repository = options.repository ?? createMockParameterCatalogGovernanceRepository();
  const spies = {
    createProposal: vi.spyOn(repository, "createProposal"),
    submitProposal: vi.spyOn(repository, "submitProposal"),
    withdrawProposal: vi.spyOn(repository, "withdrawProposal"),
    acceptProposal: vi.spyOn(repository, "acceptProposal"),
    rejectProposal: vi.spyOn(repository, "rejectProposal")
  };
  const view = render(
    <ProposalPanel
      actor={options.actor ?? "user"}
      domainState={ready}
      repository={repository}
      catalogReleaseId={CATALOG_RELEASE_ID}
      currentPersonId={options.currentPersonId ?? CATALOG_AUTHOR_PERSON_ID}
      definitionId={CATALOG_DEFINITION_ID}
      definitionRevisionId={CATALOG_REVISION_ID}
      createIdempotencyKey={options.createIdempotencyKey ?? (() => "key-proposal")}
    />
  );
  return { ...view, repository, ...spies };
}

async function confirmAction(confirmName: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "继续确认" }));
  const confirm = await screen.findByRole("dialog", { name: /确认/ });
  await user.click(within(confirm).getByRole("checkbox"));
  await user.click(within(confirm).getByRole("button", { name: confirmName }));
}

describe("ProposalPanel", () => {
  it("lets a User create a Proposal without materializing a definition", async () => {
    const { createProposal, acceptProposal } = renderPanel({ actor: "user" });
    const user = userEvent.setup();
    const region = await screen.findByRole("region", { name: "定义修订" });
    expect(within(region).getByText("不会在此界面生成参数定义")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("变更类型"), "documentation");
    await user.type(screen.getByLabelText("原因"), "补充文档");
    await confirmAction("确认提出修订");
    await waitFor(() => expect(createProposal).toHaveBeenCalledTimes(1));
    expect(createProposal).toHaveBeenCalledWith(
      {
        base: {
          catalogReleaseId: CATALOG_RELEASE_ID,
          definitionId: CATALOG_DEFINITION_ID,
          definitionRevisionId: CATALOG_REVISION_ID
        },
        requestedChange: { kind: "documentation" },
        reason: "补充文档"
      },
      { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: "key-proposal" }
    );
    expect(acceptProposal).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /生成定义|物化|应用到目录/ })).not.toBeInTheDocument();
  });

  it("lets Org Admin withdraw a submitted Proposal with If-Match", async () => {
    const { withdrawProposal, acceptProposal } = renderPanel({ actor: "org-admin" });
    await screen.findByRole("region", { name: "定义修订" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "撤回修订" }));
    const confirm = await screen.findByRole("dialog", { name: "确认撤回修订" });
    await user.click(within(confirm).getByRole("checkbox"));
    await user.click(within(confirm).getByRole("button", { name: "确认撤回" }));
    await waitFor(() => expect(withdrawProposal).toHaveBeenCalledTimes(1));
    expect(withdrawProposal).toHaveBeenCalledWith(
      CATALOG_PROPOSAL_ID,
      {},
      {
        catalogReleaseId: CATALOG_RELEASE_ID,
        idempotencyKey: "key-proposal",
        ifMatch: catalogProposal.etag
      }
    );
    expect(acceptProposal).not.toHaveBeenCalled();
  });

  it("lets a distinct Platform Admin accept without creating a definition", async () => {
    const { acceptProposal, createProposal } = renderPanel({
      actor: "platform-admin",
      currentPersonId: CATALOG_REVIEWER_PERSON_ID
    });
    await screen.findByRole("region", { name: "定义修订" });
    expect(screen.queryByRole("button", { name: "提出定义修订" })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("仓库引用"), "repo@sha");
    await user.click(screen.getByRole("button", { name: "接受修订" }));
    const confirm = await screen.findByRole("dialog", { name: "确认接受修订" });
    await user.click(within(confirm).getByRole("checkbox"));
    await user.click(within(confirm).getByRole("button", { name: "确认接受" }));
    await waitFor(() => expect(acceptProposal).toHaveBeenCalledTimes(1));
    expect(acceptProposal).toHaveBeenCalledWith(
      CATALOG_PROPOSAL_ID,
      { repositoryReference: "repo@sha" },
      {
        catalogReleaseId: CATALOG_RELEASE_ID,
        idempotencyKey: "key-proposal",
        ifMatch: catalogProposal.etag
      }
    );
    expect(createProposal).not.toHaveBeenCalled();
    expect(await screen.findByText(/发布意图已记录/)).toBeVisible();
    expect(screen.queryByText(/参数定义已生成|已物化/)).not.toBeInTheDocument();
  });

  it("blocks self-approval and Agent writes", async () => {
    const self = renderPanel({
      actor: "platform-admin",
      currentPersonId: CATALOG_AUTHOR_PERSON_ID
    });
    await screen.findByRole("region", { name: "定义修订" });
    expect(screen.getByRole("button", { name: "接受修订" })).toBeDisabled();
    expect(self.acceptProposal).not.toHaveBeenCalled();
    self.unmount();

    const agentRepo = createMockParameterCatalogGovernanceRepository();
    const acceptProposal = vi.spyOn(agentRepo, "acceptProposal");
    const createProposal = vi.spyOn(agentRepo, "createProposal");
    render(
      <ProposalPanel
        actor="agent"
        domainState={ready}
        repository={agentRepo}
        catalogReleaseId={CATALOG_RELEASE_ID}
        currentPersonId={CATALOG_REVIEWER_PERSON_ID}
      />
    );
    await screen.findByRole("region", { name: "定义修订" });
    expect(screen.queryByRole("button", { name: "提出定义修订" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "接受修订" })).not.toBeInTheDocument();
    expect(screen.getByText(/仅可阅读/)).toBeVisible();
    expect(acceptProposal).not.toHaveBeenCalled();
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("preserves Proposal input on stale conflict without retrying", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    const acceptProposal = vi.spyOn(repository, "acceptProposal").mockRejectedValue(
      catalogApiFailure("proposal-stale", { catalogReleaseId: CATALOG_RELEASE_ID })
    );
    renderPanel({
      actor: "platform-admin",
      currentPersonId: CATALOG_REVIEWER_PERSON_ID,
      repository
    });
    await screen.findByRole("region", { name: "定义修订" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("仓库引用"), "repo@keep");
    await user.click(screen.getByRole("button", { name: "接受修订" }));
    const confirm = await screen.findByRole("dialog", { name: "确认接受修订" });
    await user.click(within(confirm).getByRole("checkbox"));
    await user.click(within(confirm).getByRole("button", { name: "确认接受" }));
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveAttribute("data-preserve-input", "true");
    expect(banner).toHaveAttribute("data-silent-retry", "false");
    expect(screen.getByLabelText("仓库引用")).toHaveValue("repo@keep");
    expect(acceptProposal).toHaveBeenCalledTimes(1);
  });
});
