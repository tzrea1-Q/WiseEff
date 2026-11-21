import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { DefinitionExamples } from "./DefinitionExamples";

it("renders verbatim, keyboard-scrollable source and one compact line per legacy example", () => {
  const source = "\tmatrix =\n\t\t<0x01 2>, /* comment */\n\t\t<3 4>;  ";
  const examples = [{ nested: [1, 2] }, "line\nbreak"];
  const { rerender } = render(<DefinitionExamples examples={examples} dtsExamples={[source, "<0x3>"]} />);
  const pre = screen.getByRole("region", { name: "DTS 示例 1" });
  expect(pre.tagName).toBe("PRE");
  expect(pre).toHaveAttribute("tabindex", "0");
  expect(pre.textContent).toBe(source);
  expect(screen.getByRole("region", { name: "DTS 示例 2" }).textContent).toBe("<0x3>");
  expect(screen.queryByRole("region", { name: "示例 1" })).toBeNull();
  rerender(<DefinitionExamples examples={examples} />);
  expect(screen.getByRole("region", { name: "示例 1" }).textContent).toBe('{"nested":[1,2]}');
  expect(screen.getByRole("region", { name: "示例 2" }).textContent).toBe('"line\\nbreak"');
});
