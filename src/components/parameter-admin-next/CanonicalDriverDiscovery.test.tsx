import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import { CanonicalDriverDiscovery } from "./CanonicalDriverDiscovery";

const pin = { id: "crel_one", digest: "sha256:one" };
const item = (observationId: string, compatible = "vendor,device") => ({
  observationId, projectId: "project_one", logicalNodeId: "node_one",
  configRevisionId: "revision_one", observedCatalogReleaseId: pin.id,
  observedMatcherRevision: "matcher_one",
  source: { status: "current", configSetId: "config_one", sourceName: "device.dts",
    fileVersionId: "version_one", sourceDigest: "sha256:source", revisionDigest: "sha256:revision" },
  compatibles: [{ compatible, candidate: { kind: "review-required", reason: "unknown",
    reviewItemIds: ["review_one", "review_two"] } }]
});
const ready = (items: unknown[], nextCursor: string | null, ignoredReviewItemCount: number | null = 0) => ({
  status: "ready", catalogRelease: pin, matcherRevision: "matcher_one", items,
  nextCursor, ignoredReviewItemCount
});
const port = (listDriverCompatibleDiscovery: ReturnType<typeof vi.fn>) =>
  ({ listDriverCompatibleDiscovery } as unknown as ParameterCatalogGovernanceRepository);

describe("CanonicalDriverDiscovery", () => {
  it("uses the first ready release pin for later observation pages and opens exact review IDs", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce(ready([item("obs_one")], "obs_one", null))
      .mockResolvedValueOnce(ready([item("obs_two", "vendor,second")], null, null));
    const onNavigate = vi.fn();
    render(<CanonicalDriverDiscovery governance={port(list)} organizationId="org_one" onNavigate={onNavigate} />);
    expect(await screen.findByText("vendor,device")).toBeInTheDocument();
    expect(screen.getByText(/已忽略复核项：无权查看/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加载下一页" }));
    expect(await screen.findByText("vendor,second")).toBeInTheDocument();
    expect(list).toHaveBeenNthCalledWith(2, "org_one", { cursor: "obs_one", limit: 50 }, pin);
    fireEvent.click(screen.getAllByRole("button", { name: "查看复核项 review_two" })[0]!);
    expect(onNavigate).toHaveBeenCalledWith("/parameter-admin/specs?reviewItemId=review_two");
  });

  it("does not merge a drifted page and refreshes from the first page", async () => {
    const list = vi.fn().mockResolvedValueOnce(ready([item("obs_one")], "obs_one"))
      .mockResolvedValueOnce({ status: "unavailable", reason: "release-drift" })
      .mockResolvedValueOnce(ready([], null, 0));
    render(<CanonicalDriverDiscovery governance={port(list)} organizationId="org_one" />);
    expect(await screen.findByText("vendor,device")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加载下一页" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("目录发布已变化");
    expect(screen.getByText("vendor,device")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新发现" }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("当前范围没有兼容发现。")).toBeInTheDocument();
    expect(screen.getByText(/已忽略复核项：0/)).toBeInTheDocument();
  });

  it("keeps historical and unavailable sources distinct from current actions", async () => {
    const historical = { ...item("obs_history"), source: { status: "historical",
      currentConfigRevisionId: "revision_two", historicalCompatibles: ["vendor,old"] }, compatibles: [] };
    const unavailable = { ...item("obs_missing"), source: { status: "unavailable", reason: "source-missing" }, compatibles: [] };
    const list = vi.fn().mockResolvedValue(ready([historical, unavailable], null));
    render(<CanonicalDriverDiscovery governance={port(list)} organizationId="org_one" />);
    expect(await screen.findByText(/历史 compatible：vendor,old/)).toBeInTheDocument();
    expect(screen.getByText(/来源不可用：source-missing/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /查看主体|查看复核项/ })).not.toBeInTheDocument();
  });

  it("distinguishes a hidden Review Item association from an empty open list", async () => {
    const hidden = { ...item("obs_hidden"), compatibles: [{ compatible: "vendor,hidden",
      candidate: { kind: "review-required", reason: "unknown", reviewItemIds: null } }] };
    const empty = item("obs_empty", "vendor,empty");
    empty.compatibles[0]!.candidate.reviewItemIds = [];
    const list = vi.fn().mockResolvedValue(ready([hidden, empty], null, null));
    render(<CanonicalDriverDiscovery governance={port(list)} organizationId="org_one" />);
    expect(await screen.findByText(/复核项关联不可查看/)).toBeInTheDocument();
    expect(screen.getByText(/没有开放的复核项/)).toBeInTheDocument();
    expect(screen.getByText(/已忽略复核项：无权查看/)).toBeInTheDocument();
  });

  it("does not merge a page from a changed matcher revision", async () => {
    const list = vi.fn().mockResolvedValueOnce(ready([item("obs_one")], "obs_one"))
      .mockResolvedValueOnce({ ...ready([item("obs_two", "vendor,new")], null), matcherRevision: "matcher_two" });
    render(<CanonicalDriverDiscovery governance={port(list)} organizationId="org_one" />);
    expect(await screen.findByText("vendor,device")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加载下一页" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("识别规则已变化");
    expect(screen.queryByText("vendor,new")).not.toBeInTheDocument();
  });

  it("ignores a late page from the previous organization", async () => {
    let resolveOld!: (value: ReturnType<typeof ready>) => void;
    const old = new Promise<ReturnType<typeof ready>>(resolve => { resolveOld = resolve; });
    const list = vi.fn().mockReturnValueOnce(old)
      .mockResolvedValueOnce(ready([item("obs_new", "vendor,new")], null));
    const governance = port(list);
    const view = render(<CanonicalDriverDiscovery governance={governance} organizationId="org_old" />);
    view.rerender(<CanonicalDriverDiscovery governance={governance} organizationId="org_new" />);
    expect(await screen.findByText("vendor,new")).toBeInTheDocument();
    await act(async () => resolveOld(ready([item("obs_old", "vendor,old")], null)));
    expect(screen.queryByText("vendor,old")).not.toBeInTheDocument();
    expect(list).toHaveBeenNthCalledWith(2, "org_new", { limit: 50 });
  });
});
