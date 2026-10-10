import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CATALOG_ORGANIZATION_ID,
  CATALOG_PLACEMENT_ID,
  CATALOG_REGISTRATION_ID,
  CATALOG_RELEASE_ID,
  CATALOG_REVIEW_ITEM_ID,
  CATALOG_SUBJECT_ID,
  catalogReviewItem,
  readyCatalogDocument
} from "@/application/parameter-catalog/fixtures";
import { catalogApiFailure } from "@/application/parameter-catalog/errors";
import { createMockParameterCatalogGovernanceRepository } from "@/application/parameter-catalog/mockAdapter";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import type { CatalogReviewItemResponse } from "@/infrastructure/http/parameterCatalogDtos";

import { ReviewResolutionDialog } from "./ReviewResolutionDialog";

const ready = deriveCatalogDomainState({ document: readyCatalogDocument });

function item(
  overrides: Partial<CatalogReviewItemResponse["item"]> = {}
): CatalogReviewItemResponse["item"] {
  return {
    ...catalogReviewItem,
    ...overrides
  };
}

function renderDialog(options: {
  actor?: CatalogActorKind;
  reviewItem?: CatalogReviewItemResponse["item"];
  repository?: ReturnType<typeof createMockParameterCatalogGovernanceRepository>;
  createIdempotencyKey?: () => string;
} = {}) {
  const repository = options.repository ?? createMockParameterCatalogGovernanceRepository();
  const resolveReviewItem = vi.spyOn(repository, "resolveReviewItem");
  const createRegistration = vi.spyOn(repository, "createRegistration");
  const createProposal = vi.spyOn(repository, "createProposal");
  render(
    <ReviewResolutionDialog
      open
      actor={options.actor ?? "org-admin"}
      domainState={ready}
      repository={repository}
      organizationId={CATALOG_ORGANIZATION_ID}
      catalogReleaseId={CATALOG_RELEASE_ID}
      item={options.reviewItem ?? item()}
      placementOptions={[{ id: CATALOG_PLACEMENT_ID, displayName: "根放置" }]}
      defaultRegistrationId={CATALOG_REGISTRATION_ID}
      createIdempotencyKey={options.createIdempotencyKey ?? (() => "key-resolve")}
      onOpenChange={vi.fn()}
    />
  );
  return { repository, resolveReviewItem, createRegistration, createProposal };
}

async function confirmResolve() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("原因"), "按证据处理");
  await user.click(screen.getByRole("button", { name: "继续确认" }));
  const confirm = await screen.findByRole("dialog", { name: "确认处理审核" });
  await user.click(within(confirm).getByRole("checkbox"));
  await user.click(within(confirm).getByRole("button", { name: "确认处理" }));
  return user;
}

describe("ReviewResolutionDialog", () => {
  it("requires an explicit candidate and reason instead of accepting the first ambiguous subject", async () => {
    const user = userEvent.setup();
    const selectedSubjectId = "csub_explicit_selection";
    const { resolveReviewItem, createRegistration } = renderDialog({
      reviewItem: item({
        candidates: [
          { subjectId: CATALOG_SUBJECT_ID, evidence: ["first candidate"] },
          { subjectId: selectedSubjectId, evidence: ["second candidate"] }
        ],
        allowedResolutions: ["register-subject"]
      })
    });
    const proceed = screen.getByRole("button", { name: "继续确认" });

    expect(screen.queryByRole("button", { name: /接受第一个|accept first/i })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("原因"), "按证据选择主体");
    expect(proceed).toBeDisabled();
    await user.click(proceed);
    expect(screen.queryByRole("dialog", { name: "确认处理审核" })).not.toBeInTheDocument();
    expect(resolveReviewItem).not.toHaveBeenCalled();

    const candidates = screen.getByRole("combobox", { name: "选择候选主体" });
    expect(candidates).toHaveValue("");
    await user.selectOptions(candidates, selectedSubjectId);
    await user.clear(screen.getByLabelText("原因"));
    await user.type(screen.getByLabelText("原因"), "   ");
    expect(proceed).toBeDisabled();
    await user.click(proceed);
    expect(resolveReviewItem).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("原因"));
    await confirmResolve();
    await waitFor(() => expect(resolveReviewItem).toHaveBeenCalledTimes(1));
    expect(resolveReviewItem).toHaveBeenCalledWith(
      CATALOG_ORGANIZATION_ID,
      CATALOG_REVIEW_ITEM_ID,
      {
        resolution: {
          type: "register-subject",
          subjectId: selectedSubjectId,
          placement: { mode: "use-default" }
        },
        reason: "按证据处理"
      },
      { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: "key-resolve", ifMatch: "etag-1" }
    );
    expect(createRegistration).not.toHaveBeenCalled();
  });

  it("submits one atomic resolveReviewItem command with release, ETag, and idempotency", async () => {
    const { resolveReviewItem, createRegistration } = renderDialog({
      reviewItem: item({ allowedResolutions: ["register-subject"] })
    });
    await userEvent.setup().click(screen.getByRole("radio", { name: "使用默认根放置" }));
    await confirmResolve();
    await waitFor(() => expect(resolveReviewItem).toHaveBeenCalledTimes(1));
    expect(resolveReviewItem).toHaveBeenCalledWith(
      CATALOG_ORGANIZATION_ID,
      CATALOG_REVIEW_ITEM_ID,
      {
        resolution: {
          type: "register-subject",
          subjectId: CATALOG_SUBJECT_ID,
          placement: { mode: "use-default" }
        },
        reason: "按证据处理"
      },
      {
        catalogReleaseId: CATALOG_RELEASE_ID,
        idempotencyKey: "key-resolve",
        ifMatch: "etag-1"
      }
    );
    expect(createRegistration).not.toHaveBeenCalled();
  });

  it.each(["", "   "])("does not write with a blank review reason %j", async (reason) => {
    const user = userEvent.setup();
    const { resolveReviewItem } = renderDialog();
    if (reason) await user.type(screen.getByLabelText("原因"), reason);

    const proceed = screen.getByRole("button", { name: "继续确认" });
    expect(proceed).toBeDisabled();
    await user.click(proceed);
    expect(screen.queryByRole("dialog", { name: "确认处理审核" })).not.toBeInTheDocument();
    expect(resolveReviewItem).not.toHaveBeenCalled();
  });

  it("keeps mark-out-of-scope available without choosing an ambiguous subject", async () => {
    const { resolveReviewItem } = renderDialog({
      reviewItem: item({
        candidates: [
          { subjectId: CATALOG_SUBJECT_ID, evidence: ["first candidate"] },
          { subjectId: "csub_other_candidate", evidence: ["second candidate"] }
        ],
        allowedResolutions: ["register-subject", "mark-out-of-scope"]
      })
    });
    await userEvent.setup().click(screen.getByRole("radio", { name: "标为范围外" }));
    await confirmResolve();

    await waitFor(() => expect(resolveReviewItem).toHaveBeenCalledTimes(1));
    expect(resolveReviewItem.mock.calls[0]?.[2]).toEqual({
      resolution: { type: "mark-out-of-scope" },
      reason: "按证据处理"
    });
  });

  it("does not create a Registration or Proposal as a partial second command", async () => {
    const { resolveReviewItem, createRegistration, createProposal } = renderDialog({
      reviewItem: item({ allowedResolutions: ["open-definition-proposal"] })
    });
    await userEvent.setup().click(screen.getByRole("radio", { name: "打开定义修订" }));
    await confirmResolve();
    await waitFor(() => expect(resolveReviewItem).toHaveBeenCalledTimes(1));
    expect(resolveReviewItem.mock.calls[0]?.[2]).toEqual({
      resolution: { type: "open-definition-proposal" },
      reason: "按证据处理"
    });
    expect(createRegistration).not.toHaveBeenCalled();
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("restores a Registration without sending a Placement payload", async () => {
    const { resolveReviewItem } = renderDialog({
      reviewItem: item({ allowedResolutions: ["restore-registration"] })
    });
    await confirmResolve();
    await waitFor(() => expect(resolveReviewItem).toHaveBeenCalledTimes(1));
    expect(resolveReviewItem.mock.calls[0]?.[2]).toEqual({
      resolution: {
        type: "restore-registration",
        registrationId: CATALOG_REGISTRATION_ID
      },
      reason: "按证据处理"
    });
  });

  it("preserves resolution input on revision conflict without retrying", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    vi.spyOn(repository, "resolveReviewItem").mockRejectedValue(
      catalogApiFailure("revision-conflict", { catalogReleaseId: CATALOG_RELEASE_ID })
    );
    const { resolveReviewItem } = renderDialog({
      repository,
      reviewItem: item({ allowedResolutions: ["mark-out-of-scope"] })
    });
    await confirmResolve();
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveAttribute("data-preserve-input", "true");
    expect(banner).toHaveAttribute("data-silent-retry", "false");
    expect(screen.getByLabelText("原因")).toHaveValue("按证据处理");
    expect(screen.getByRole("radio", { name: "标为范围外" })).toBeChecked();
    expect(resolveReviewItem).toHaveBeenCalledTimes(1);
  });

  it("refuses Agent resolution and stale candidates without writing", () => {
    const { resolveReviewItem } = renderDialog({ actor: "agent" });
    expect(screen.getByText(/仅可阅读/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "继续确认" })).not.toBeInTheDocument();
    expect(resolveReviewItem).not.toHaveBeenCalled();
  });

  it("blocks resolution when review evidence is stale", () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    const resolveReviewItem = vi.spyOn(repository, "resolveReviewItem");
    render(
      <ReviewResolutionDialog
        open
        actor="org-admin"
        domainState={ready}
        repository={repository}
        organizationId={CATALOG_ORGANIZATION_ID}
        catalogReleaseId={CATALOG_RELEASE_ID}
        item={item({
          candidateState: {
            status: "stale",
            capturedRelease: { id: "crel_old", digest: "sha256:old" },
            currentRelease: { id: CATALOG_RELEASE_ID, digest: "sha256:abc" }
          }
        })}
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByRole("alert")).toHaveAttribute("data-silent-retry", "false");
    expect(screen.queryByRole("button", { name: "继续确认" })).not.toBeInTheDocument();
    expect(resolveReviewItem).not.toHaveBeenCalled();
  });
});
