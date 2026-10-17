import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReviewSourceDiff, reviewLocator } from "./ReviewSourceDiff";

describe("frozen source comparison", () => {
  it("aligns multiple inserted and removed lines, collapses distant unchanged content and preserves complete source", () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index}`);
    const after = [...lines];
    after.splice(10, 0, "inserted one", "inserted two");
    after.splice(72, 1);
    render(<ReviewSourceDiff before={lines.join("\n")} after={after.join("\n")} />);
    const changes = screen.getByRole("region", { name: "固定源修改片段" });
    expect(changes.querySelectorAll('[data-kind="add"]')).toHaveLength(2);
    expect(changes.querySelectorAll('[data-kind="remove"]')).toHaveLength(1);
    expect(within(changes).getAllByText("新增行")).toHaveLength(2);
    expect(within(changes).getAllByText("删除行")).toHaveLength(1);
    expect(within(changes).getAllByText("上下文").length).toBeGreaterThan(0);
    expect(within(changes).queryByText("line 40")).not.toBeInTheDocument();
    expect(screen.getByLabelText("固定源变更前")).not.toBeVisible();
    fireEvent.click(screen.getByText("查看完整源文件"));
    expect(screen.getByLabelText("固定源变更前")).toBeVisible();
    expect(screen.getByLabelText("固定源变更前").textContent).toBe(lines.join("\n"));
    expect(screen.getByLabelText("固定源变更后").textContent).toBe(after.join("\n"));
  });

  it("handles an unchanged file, empty side, repeated lines and a replacement without losing source", () => {
    const rendered = render(<ReviewSourceDiff before="same" after="same" />);
    expect(screen.getByText("源文件内容没有变化。")).toBeInTheDocument();
    rendered.rerender(<ReviewSourceDiff before="a\na\nb\n" after="a\nc\na\n" />);
    const region = screen.getByRole("region", { name: "固定源修改片段" });
    expect(region.querySelectorAll('[data-kind="add"]')).toHaveLength(1);
    expect(region.querySelectorAll('[data-kind="remove"]')).toHaveLength(1);
    rendered.rerender(<ReviewSourceDiff before="" after="new" />);
    expect(screen.getByRole("region", { name: "固定源修改片段" })).toHaveTextContent("new");
    expect(reviewLocator({ nodePath: "/battery", propertyName: "limit" })).toBe("/battery · limit");
    expect(reviewLocator({ pointer: "/limit" })).toBe("/limit");
    expect(reviewLocator('{"kind":"json-pointer","pointer":"/settings/limit"}')).toBe("/settings/limit");
    expect(reviewLocator('{"kind":"dts-property","propertyName":"iin_max","fileVersionId":"hidden-uuid"}')).toBe("iin_max");
    expect(reviewLocator("{broken")).toBe("参数路径待核对");
  });
});
