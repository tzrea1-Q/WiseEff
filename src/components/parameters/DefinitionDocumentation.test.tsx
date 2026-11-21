import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DefinitionDocumentation } from "./DefinitionDocumentation";

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
});
