import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { selectControlOption } from "@/test/selectControlOption";
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
import { catalogApiFailure } from "@/application/parameter-catalog/errors";
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
      totalCount: 1,
      hasMore: false,
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
  it.each(["not-found", "release-drift"])("keeps prior review evidence blocked after refresh %s", async (failure) => {
    const repository = createMockParameterCatalogGovernanceRepository();
    vi.spyOn(repository, "listReviewItems").mockResolvedValue({ items: [{ ...catalogReviewItem,
      allowedResolutions: ["mark-out-of-scope"] }], nextCursor: null, totalCount: 1, hasMore: false, catalogReleaseId: CATALOG_RELEASE_ID });
    const resolve = vi.spyOn(repository, "resolveReviewItem").mockRejectedValue(
      catalogApiFailure("revision-conflict", { catalogReleaseId: CATALOG_RELEASE_ID }));
    const get = vi.spyOn(repository, "getReviewItem");
    if (failure === "not-found") get.mockRejectedValue(new Error("404"));
    else get.mockResolvedValue({ item: { ...catalogReviewItem, catalogReleaseId: "different-release", etag: "new-etag" } });
    render(<ReviewQueue actor="org-admin" domainState={ready} repository={repository} organizationId={CATALOG_ORGANIZATION_ID}
      catalogReleaseId={CATALOG_RELEASE_ID} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "处理审核" }));
    expect(await screen.findByText(/暂时无法核对最新审核依据/)).toBeVisible();
    await user.type(screen.getByLabelText("原因"), "保留审核证据");
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText(/暂时无法核对最新审核依据/)).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "确认处理审核" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("原因")).toHaveValue("保留审核证据");
    expect(resolve).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith(CATALOG_ORGANIZATION_ID, CATALOG_REVIEW_ITEM_ID);
  });
  it("clears a locally selected review when the organization changes", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    const props = { actor: "org-admin" as const, domainState: ready, repository, catalogReleaseId: CATALOG_RELEASE_ID };
    const view = render(<ReviewQueue {...props} organizationId={CATALOG_ORGANIZATION_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "处理审核" }));
    expect(screen.getByRole("dialog", { name: "处理审核" })).toBeVisible();
    view.rerender(<ReviewQueue {...props} organizationId="different-organization" />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("explains a missing bookmarked review and retries its exact organization-scoped read", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    const get = vi.spyOn(repository, "getReviewItem").mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce({ item: catalogReviewItem });
    render(<ReviewQueue actor="org-admin" domainState={ready} repository={repository} organizationId={CATALOG_ORGANIZATION_ID}
      catalogReleaseId={CATALOG_RELEASE_ID} selectedReviewItemId={CATALOG_REVIEW_ITEM_ID} />);
    expect(await screen.findByText(/链接中的审核项不存在/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("dialog", { name: "处理审核" })).toBeVisible();
    expect(get).toHaveBeenLastCalledWith(CATALOG_ORGANIZATION_ID, CATALOG_REVIEW_ITEM_ID);
  });

  it("rereads the same bookmarked id after an organization switch instead of using prior list rows", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    const get = vi.spyOn(repository, "getReviewItem").mockResolvedValue({ item: catalogReviewItem });
    const props = { actor: "org-admin" as const, domainState: ready, repository,
      catalogReleaseId: CATALOG_RELEASE_ID, selectedReviewItemId: CATALOG_REVIEW_ITEM_ID };
    const view = render(<ReviewQueue {...props} organizationId={CATALOG_ORGANIZATION_ID} />);
    await screen.findByRole("dialog", { name: "处理审核" });
    await screen.findByText(/已加载 1 条审核项/);
    view.rerender(<ReviewQueue {...props} organizationId="different-organization" />);
    await waitFor(() => expect(get).toHaveBeenLastCalledWith("different-organization", CATALOG_REVIEW_ITEM_ID));
  });

  it("opens an exact bookmarked review item even outside the first cursor page", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    const target = { ...catalogReviewItem, id: "review-page-two", observation: { ...catalogReviewItem.observation!, propertyKey: "other-key" } };
    const get = vi.spyOn(repository, "getReviewItem").mockResolvedValue({ item: target });
    render(<ReviewQueue actor="org-admin" domainState={ready} repository={repository} organizationId={CATALOG_ORGANIZATION_ID}
      catalogReleaseId={CATALOG_RELEASE_ID} selectedReviewItemId={target.id} />);
    expect(await screen.findByRole("dialog", { name: "处理审核" })).toBeVisible();
    expect(get).toHaveBeenCalledWith(CATALOG_ORGANIZATION_ID, target.id);
  });

  it("retains loaded review rows and retries a failed cursor page without restarting", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    const page = { items: [catalogReviewItem], nextCursor: "page-two", catalogReleaseId: CATALOG_RELEASE_ID, totalCount: 2, hasMore: true };
    const list = vi.spyOn(repository, "listReviewItems").mockResolvedValueOnce(page).mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ...page, items: [{ ...catalogReviewItem, id: "second", observation: { ...catalogReviewItem.observation!, propertyKey: "second-key" } }], nextCursor: null, hasMore: false });
    render(<ReviewQueue actor="org-admin" domainState={ready} repository={repository} organizationId={CATALOG_ORGANIZATION_ID} catalogReleaseId={CATALOG_RELEASE_ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "加载更多审核项" }));
    const retry = await screen.findByRole("button", { name: "重试加载审核项" });
    expect(screen.getByText("gpio-int")).toBeVisible();
    fireEvent.click(retry);
    expect(await screen.findByText("second-key")).toBeVisible();
    expect(list).toHaveBeenLastCalledWith(CATALOG_ORGANIZATION_ID, { cursor: "page-two", limit: 50, catalogReleaseId: CATALOG_RELEASE_ID });
  });
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
    const discovery = screen.getByRole("link", { name: "查看来源识别" });
    expect(discovery).toHaveAttribute("href", "/parameter-admin/modules/queue");
    expect(discovery).toHaveAttribute("data-slot", "button");
    expect(discovery).toHaveAttribute("data-variant", "outline");
    expect(discovery).toHaveClass("self-start");
    expect(screen.queryByRole("button", { name: "处理审核" })).not.toBeInTheDocument();
  });

  it("keeps identifiers in source details while prioritizing the readable review object", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    const id = `prit_${"a".repeat(64)}`;
    vi.spyOn(repository, "listReviewItems").mockResolvedValue({ items: [{ ...catalogReviewItem, id }],
      nextCursor: null, totalCount: 1, hasMore: false, catalogReleaseId: CATALOG_RELEASE_ID });
    render(<ReviewQueue actor="org-admin" domainState={ready} repository={repository}
      organizationId={CATALOG_ORGANIZATION_ID} catalogReleaseId={CATALOG_RELEASE_ID} />);
    const identifier = await screen.findByTitle(id);
    expect(identifier).toHaveTextContent(id);
    expect(identifier.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("gpio-int")).toBeVisible();
    expect(screen.getByText("识别不唯一").closest("td")).toHaveClass("whitespace-nowrap");
    expect(screen.getByRole("button", { name: "处理审核" })).toBeEnabled();
  });

  it("searches real source facts, filters reasons and keeps the audit history entry scoped to governance", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    vi.spyOn(repository, "listReviewItems").mockResolvedValue({ items: [{ ...catalogReviewItem,
      sourceSummary: { status: "available", evidenceCount: 1, compatible: "vendor,charger", projectId: "project-a",
        projectName: "电源预览项目", fileName: "board.dts", nodeLocator: "/charger", propertyKey: "compatible" }
    }], nextCursor: null, totalCount: 1, hasMore: false, catalogReleaseId: CATALOG_RELEASE_ID });
    const onCountChange = vi.fn();
    render(<ReviewQueue actor="org-admin" domainState={ready} repository={repository}
      organizationId={CATALOG_ORGANIZATION_ID} catalogReleaseId={CATALOG_RELEASE_ID} onCountChange={onCountChange} />);
    expect(await screen.findByText("vendor,charger")).toBeVisible();
    expect(screen.getByText("电源预览项目")).toBeVisible();
    expect(screen.getByRole("link", { name: "处理记录" })).toHaveAttribute("href", "/audit?kind=parameter-catalog-governance");
    expect(onCountChange).toHaveBeenLastCalledWith(1);
    await userEvent.type(screen.getByRole("searchbox", { name: "搜索待审核事项" }), "not-a-source");
    expect(await screen.findByText("没有匹配的审核项。")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByText("vendor,charger")).toBeVisible();
  });

  it("keeps an opened row mounted when its URL selection arrives instead of re-reading and discarding its draft", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    const getReviewItem = vi.spyOn(repository, "getReviewItem");
    const onSelectReviewItem = vi.fn();
    const props = { actor: "org-admin" as const, domainState: ready, repository, organizationId: CATALOG_ORGANIZATION_ID,
      catalogReleaseId: CATALOG_RELEASE_ID, onSelectReviewItem };
    const view = render(<ReviewQueue {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: "处理审核" }));
    await userEvent.type(screen.getByRole("textbox", { name: "原因" }), "保留已填写内容");
    view.rerender(<ReviewQueue {...props} selectedReviewItemId={CATALOG_REVIEW_ITEM_ID} />);
    expect(screen.getByRole("textbox", { name: "原因" })).toHaveValue("保留已填写内容");
    expect(getReviewItem).toHaveBeenCalledTimes(1);
  });

  it("matches every source in a grouped review rather than only its first project", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    const first = { status: "available" as const, evidenceCount: 1, projectId: "first-project", projectName: "首个项目", fileName: "first.dts", compatible: "vendor,first" };
    const second = { ...first, projectId: "second-project", projectName: "后续项目", fileName: "second.dts", compatible: "vendor,second" };
    vi.spyOn(repository, "listReviewItems").mockResolvedValue({ items: [{ ...catalogReviewItem,
      sourceSummary: first, sources: [first, second] }], nextCursor: null, totalCount: 1, hasMore: false, catalogReleaseId: CATALOG_RELEASE_ID });
    render(<ReviewQueue actor="org-admin" domainState={ready} repository={repository}
      organizationId={CATALOG_ORGANIZATION_ID} catalogReleaseId={CATALOG_RELEASE_ID} />);
    await screen.findByText("涉及 2 处来源");
    await selectControlOption(screen.getByRole("combobox", { name: "筛选来源项目" }), "second-project");
    expect(screen.getByRole("button", { name: "处理审核" })).toBeVisible();
    await userEvent.type(screen.getByRole("searchbox", { name: "搜索待审核事项" }), "vendor,second");
    expect(screen.getByRole("button", { name: "处理审核" })).toBeVisible();
    expect(screen.queryByText("没有匹配的审核项。")).not.toBeInTheDocument();
  });

  it("keeps Agent read-only and does not offer resolution", async () => {
    const { resolveReviewItem } = renderQueue({ actor: "agent" });
    await screen.findByRole("region", { name: "待审核事项" });
    expect(screen.queryByRole("button", { name: "处理审核" })).not.toBeInTheDocument();
    expect(resolveReviewItem).not.toHaveBeenCalled();
    expect(screen.getByText(CATALOG_REVIEW_ITEM_ID)).toBeInTheDocument();
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
