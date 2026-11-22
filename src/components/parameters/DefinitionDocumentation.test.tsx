import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DefinitionDocumentation, definitionDocumentationExcerpt } from "./DefinitionDocumentation";

describe("DefinitionDocumentation", () => {
  it("renders paragraphs, lists and verbatim fenced code", () => {
    const { container } = render(<DefinitionDocumentation
      documentation={"First line\nSecond line\n\n- **Enabled**\n\n```dts\n\tvalue = <1>;\n\n\tstatus = \"okay\";\n  ```"} />);

    const paragraph = container.querySelector("p");
    const lineBreak = paragraph?.querySelector("br");
    expect(lineBreak?.previousSibling?.textContent).toBe("First line");
    expect(lineBreak?.nextSibling?.textContent).toBe("Second line");
    expect(within(screen.getByRole("list")).getByRole("listitem").querySelector("strong")).toHaveTextContent("Enabled");
    expect(container.querySelector("pre > code")?.textContent).toBe('\tvalue = <1>;\n\n\tstatus = "okay";');
  });

  it("keeps the caller's empty state", () => {
    render(<DefinitionDocumentation documentation={null} empty="尚无参数说明。" />);
    expect(screen.getByText("尚无参数说明。")).toBeInTheDocument();
  });

  it("collapses Markdown into a plain-text excerpt for list previews", () => {
    expect(definitionDocumentationExcerpt("### 作用\n- **电流** 上限\n\n| 温度 | 电流 |\n| --- | --- |\n| 0 | 500 |\n```dts\nx = <1>;\n```"))
      .toBe("作用 电流 上限 温度 · 电流 0 · 500 x = <1>;");
    expect(definitionDocumentationExcerpt("| 模式 | 说明 |\n| --- | --- |\n| 1 | 快充<br>限流<br/>保护 |")).toBe("模式 · 说明 1 · 快充 限流 保护");
    expect(definitionDocumentationExcerpt(null)).toBe("");
  });
});
