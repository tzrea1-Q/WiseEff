import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewProvenance } from "./ReviewProvenance";

describe("ReviewProvenance", () => {
  it("keeps key IDs copyable and complete nested evidence in one secondary disclosure", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ReviewProvenance entries={[
      { label: "请求 ID", value: "request-1" },
      { label: "冻结证明", value: { members: [{ fileId: "file-1", checksum: "sha256:frozen" }], locator: { pointer: "/limit" } } }
    ]} />);
    const disclosure = screen.getByText("溯源信息").closest("details")!;
    expect(disclosure.open).toBe(false);
    expect(screen.queryByRole("button", { name: "复制 请求 ID" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("溯源信息"));
    expect(disclosure.open).toBe(true);
    expect(await screen.findByLabelText("完整溯源数据")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "复制 请求 ID" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("request-1"));
    expect(screen.getByRole("status")).toHaveTextContent("已复制请求 ID");
    fireEvent.click(screen.getByText("完整技术数据", { exact: true }));
    expect(screen.getByLabelText("完整溯源数据")).toBeVisible();
    expect(JSON.parse(screen.getByLabelText("完整溯源数据").textContent!)).toMatchObject({
      "冻结证明": { members: [{ fileId: "file-1", checksum: "sha256:frozen" }], locator: { pointer: "/limit" } }
    });
    fireEvent.click(screen.getByRole("button", { name: "复制完整技术数据" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(screen.getByLabelText("完整溯源数据").textContent));
  });
});
