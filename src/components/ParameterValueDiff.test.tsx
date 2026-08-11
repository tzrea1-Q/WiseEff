import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ParameterValueDiff } from "@/components/ParameterValueDiff";

describe("ParameterValueDiff", () => {
  it("renders single-line changes as +/- rows without line numbers", () => {
    const { container } = render(<ParameterValueDiff baseValue={'"1"'} targetValue={'"2"'} />);
    const list = screen.getByRole("list");
    expect(list).toHaveClass("submission-preview-diff--scalar");
    expect(list).toHaveAttribute("data-kind", "changed");
    expect(container.querySelectorAll(".submission-preview-diff-row__line-number")).toHaveLength(0);
    expect(container.querySelector(".submission-preview-diff-row[data-kind='remove'] code")).toHaveTextContent('"1"');
    expect(container.querySelector(".submission-preview-diff-row[data-kind='add'] code")).toHaveTextContent('"2"');
  });

  it("keeps both baseline and debug visible for equal single-line values", () => {
    const { container } = render(<ParameterValueDiff baseValue="<6000>" targetValue="<6000>" />);
    const list = screen.getByRole("list");
    expect(list).toHaveAttribute("data-kind", "equal");
    expect(container.querySelectorAll(".submission-preview-diff-row__line-number")).toHaveLength(0);
    expect(container.querySelector(".submission-preview-diff-row[data-kind='remove'] code")).toHaveTextContent("<6000>");
    expect(container.querySelector(".submission-preview-diff-row[data-kind='add'] code")).toHaveTextContent("<6000>");
  });

  it("keeps unified line chrome for multiline values", () => {
    const { container } = render(
      <ParameterValueDiff baseValue={"a\nb"} targetValue={"a\nc"} />
    );
    expect(container.querySelector(".submission-preview-diff")).toBeInTheDocument();
    expect(container.querySelector(".submission-preview-diff--scalar")).toBeNull();
    expect(container.querySelectorAll(".submission-preview-diff-row[data-kind='remove']")).toHaveLength(1);
    expect(container.querySelectorAll(".submission-preview-diff-row[data-kind='add']")).toHaveLength(1);
    expect(container.querySelectorAll(".submission-preview-diff-row__line-number").length).toBeGreaterThan(0);
  });
});
