import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterFileRepository, SourceRevisionRequest } from "@/application/ports/ParameterFileRepository";
import { initialState } from "@/mockData";
import { ReviewInbox } from "./ReviewInbox";

const request: SourceRevisionRequest = { id: "source-request", projectId: "aurora", candidateId: "candidate", fileId: "file", fileName: "board.dts", configSetId: "set",
  status: "pending", reason: "整文件注释修改", submitterUserId: "author", assignedToUserId: "reviewer", reviewerUserId: null,
  submitterName: "提交人", assignedToName: "审核人", reviewerNote: null, createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T00:00:00Z",
  proofDigest: "a".repeat(64), impact: { parameterChanges: 0, nodeAdditions: 0, nodeRemovals: 0 }, before: "/ {};\n", after: "/ {}; // comment\n" };

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/parameter-review"); });

function setup() {
  const list = vi.fn(async () => [request]);
  const get = vi.fn(async () => request);
  const source = { listSourceRevisionRequests: list, getSourceRevisionRequest: get,
    reviewSourceRevisionRequest: vi.fn(), withdrawSourceRevisionRequest: vi.fn() } as unknown as ParameterFileRepository;
  const catalog = { listProjectValueChangeRequests: vi.fn(async () => ({ items: [] })),
    listProjectValueBatchChangeRequests: vi.fn(async () => ({ items: [] })), listMemberRemovalRequests: vi.fn(async () => ({ items: [] })) } as unknown as ParameterCatalogRepository;
  const element = (userId = "reviewer", mineOnly = false) => <ReviewInbox projectId="aurora" repository={catalog} sourceRepository={source}
    state={{ ...initialState, currentUserId: userId }} search="?request=source-request&type=source" canReview mineOnly={mineOnly}
    legacyRows={[]} renderLegacyDetail={() => null} />;
  return { list, get, source, element };
}

describe("whole-source requests in the shared inbox", () => {
  it("selects a source queue row and opens its exact whole-file review panel", async () => {
    const f = setup(); render(f.element());
    const queue = await screen.findByRole("table", { name: "审阅队列" });
    await waitFor(() => expect(queue).toHaveTextContent("board.dts"));
    expect(queue).toHaveTextContent("DTS 来源修改");
    expect(queue).toHaveTextContent("0 项参数变化");
    const detail = await screen.findByRole("complementary", { name: "审阅详情" });
    expect(await within(detail).findByRole("heading", { name: "board.dts" })).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "批准并应用 DTS" })).toBeInTheDocument();
    expect(f.get).toHaveBeenCalledWith("aurora", "source-request");
    expect(f.list).toHaveBeenCalledWith("aurora", undefined);
    expect(within(queue).getAllByRole("row").find((row) => row.textContent?.includes("board.dts"))).toHaveAttribute("aria-selected", "true");
  });

  it("uses mine scope for personal submissions and lets the author withdraw without approval actions", async () => {
    const f = setup(); render(f.element("author", true));
    await screen.findByRole("table", { name: "我的提交" });
    fireEvent.click(await screen.findByRole("button", { name: /board.dts，查看 整文件注释修改 提交详情/ }));
    expect(await screen.findByRole("button", { name: "撤回审核" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批准并应用 DTS" })).not.toBeInTheDocument();
    expect(f.list).toHaveBeenCalledWith("aurora", { mine: true });
  });

  it("drops prior source detail immediately when the signed-in identity changes", async () => {
    const f = setup(); const mounted = render(f.element());
    await screen.findByRole("button", { name: "批准并应用 DTS" });
    let resolve!: (requests: SourceRevisionRequest[]) => void;
    f.list.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    mounted.rerender(f.element("another-user"));
    expect(screen.queryByRole("button", { name: "批准并应用 DTS" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "board.dts" })).not.toBeInTheDocument();
    await act(async () => { resolve([]); });
    expect(screen.queryByRole("complementary", { name: "审阅详情" })).not.toBeInTheDocument();
  });
});
