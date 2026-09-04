import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CATALOG_ORGANIZATION_ID,
  CATALOG_RELEASE_ID,
  CATALOG_REVIEW_ITEM_ID,
  catalogReviewItem,
  readyCatalogDocument
} from "@/application/parameter-catalog/fixtures";
import { createMockParameterCatalogGovernanceRepository } from "@/application/parameter-catalog/mockAdapter";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import type { CatalogActorKind } from "@/application/parameter-catalog/authority";

import { ReviewQueue } from "./ReviewQueue";

const ready = deriveCatalogDomainState({ document: readyCatalogDocument });

function renderQueue(options: {
  actor?: CatalogActorKind;
  scenario?: "ready" | "empty-no-review-work";
  stale?: boolean;
} = {}) {
  const repository = createMockParameterCatalogGovernanceRepository({
    scenario: options.scenario ?? "ready"
  });
  const listReviewItems = vi.spyOn(repository, "listReviewItems");
  const resolveReviewItem = vi.spyOn(repository, "resolveReviewItem");
  if (options.stale) {
    listReviewItems.mockResolvedValue({
      items: [
        {
          ...catalogReviewItem,
          candidateState: {
            status: "stale",
            capturedRelease: { id: "crel_old", digest: "sha256:old" },
            currentRelease: { id: CATALOG_RELEASE_ID, digest: "sha256:abc" }
          }
        }
      ],
      nextCursor: null,
      catalogReleaseId: CATALOG_RELEASE_ID
    });
  }
  render(
    <ReviewQueue
      actor={options.actor ?? "org-admin"}
      domainState={ready}
      repository={repository}
      organizationId={CATALOG_ORGANIZATION_ID}
      catalogReleaseId={CATALOG_RELEASE_ID}
      createIdempotencyKey={() => "key-resolve"}
    />
  );
  return { repository, listReviewItems, resolveReviewItem };
}

describe("ReviewQueue", () => {
  it("lists open review work for Org Admin and opens the atomic resolution dialog", async () => {
    const { resolveReviewItem } = renderQueue();
    const region = await screen.findByRole("region", { name: "待审核事项" });
    expect(within(region).getByText("gpio-int")).toBeVisible();
    expect(within(region).getByText("识别不唯一")).toBeVisible();
    const user = userEvent.setup();
    await user.click(within(region).getByRole("button", { name: "处理审核" }));
    expect(await screen.findByRole("dialog", { name: "处理审核" })).toBeVisible();
    expect(resolveReviewItem).not.toHaveBeenCalled();
  });

  it("shows the closed no-review-work empty state", async () => {
    renderQueue({ scenario: "empty-no-review-work" });
    expect(await screen.findByText("当前没有待审核事项。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "处理审核" })).not.toBeInTheDocument();
  });

  it("keeps Agent read-only and does not offer resolution", async () => {
    const { resolveReviewItem } = renderQueue({ actor: "agent" });
    await screen.findByRole("region", { name: "待审核事项" });
    expect(screen.queryByRole("button", { name: "处理审核" })).not.toBeInTheDocument();
    expect(resolveReviewItem).not.toHaveBeenCalled();
    expect(screen.getByText(CATALOG_REVIEW_ITEM_ID)).toBeVisible();
  });

  it("disables resolution while captured review evidence is stale", async () => {
    const { resolveReviewItem } = renderQueue({ stale: true });
    const region = await screen.findByRole("region", { name: "待审核事项" });
    const action = within(region).getByRole("button", { name: "处理审核" });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute("title", expect.stringMatching(/刷新/));
    expect(resolveReviewItem).not.toHaveBeenCalled();
  });

  it("does not invent a fifth empty reason", async () => {
    renderQueue({ scenario: "empty-no-review-work" });
    await waitFor(() => expect(screen.getByText("当前没有待审核事项。")).toBeVisible());
    expect(screen.queryByText(/no-review-work|empty/i)).not.toBeInTheDocument();
  });
});
