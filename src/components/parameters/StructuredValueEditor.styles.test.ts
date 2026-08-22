import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DtsValueType } from "../../application/ports/DtsStructuredRepository";
import { allSelectors, declarationsFor, readStylesheet } from "../../test/cssAssertions";
import { StructuredValueEditor, type StructuredValueEditorProps } from "./StructuredValueEditor";

/**
 * The structured value editor shipped every one of its own class names with no rule
 * anywhere in the stylesheet, so the highest-risk write path in the parameter admin
 * rendered as unstyled HTML. Deriving the list from the rendered component means a
 * new sub-editor cannot repeat that silently without coupling this contract to its
 * source formatting or implementation details.
 */
function editorClassNames(): string[] {
  const common = {
    onChange: vi.fn(),
  } satisfies Pick<StructuredValueEditorProps, "onChange">;
  const scenarios = {
    "u32-array": {
      propertyName: "reg",
      rawText: "<0x1>",
    },
    bytes: {
      propertyName: "reg-config",
      rawText: "/bits/ 8 <0x19>",
    },
    "string-list": {
      propertyName: "compatible",
      rawText: '"vendor,device"',
    },
    "phandle-list": {
      propertyName: "interrupt-parent",
      rawText: "<&gpio>",
      availableLabels: ["gpio"],
    },
    bool: {
      propertyName: "enabled",
      rawText: "",
      present: true,
    },
    empty: {
      propertyName: "reserved",
      rawText: "",
    },
    mixed: {
      propertyName: "mixed-value",
      rawText: "<0x1>",
    },
  } satisfies Record<
    DtsValueType,
    Omit<StructuredValueEditorProps, "onChange" | "valueType">
  >;
  const editors = (Object.keys(scenarios) as DtsValueType[]).map((valueType) =>
    createElement(StructuredValueEditor, {
      ...common,
      ...scenarios[valueType],
      key: valueType,
      valueType,
    })
  );
  const { container } = render(createElement("div", null, ...editors));
  const tokens = new Set<string>();
  for (const element of container.querySelectorAll<HTMLElement>("[class]")) {
    for (const token of element.classList) {
      if (token.startsWith("structured-value")) {
        tokens.add(token);
      }
    }
  }
  return [...tokens].sort();
}

describe("StructuredValueEditor styling contract", () => {
  it("emits at least one class per sub-editor", () => {
    const classNames = editorClassNames();

    expect(classNames).toContain("structured-value-editor");
    expect(classNames).toContain("structured-value-u32-matrix");
    expect(classNames).toContain("structured-value-bytes");
    expect(classNames).toContain("structured-value-string-list");
    expect(classNames).toContain("structured-value-phandle-list");
    expect(classNames).toContain("structured-value-bool");
    expect(classNames).toContain("structured-value-mixed");
    expect(classNames).toContain("structured-value-normalized-preview");
  });

  it("styles every class the component emits", () => {
    const selectors = allSelectors(readStylesheet("src/styles.css"));
    const unstyled = editorClassNames().filter(
      (className) =>
        !selectors.some((selector) => new RegExp(`\\.${className}(?![\\w-])`).test(selector))
    );

    expect(unstyled).toEqual([]);
  });

  it("gives the editor's inputs and buttons a visible affordance", () => {
    const styles = readStylesheet("src/styles.css");
    const inputRule = declarationsFor(styles, '.structured-value-editor input:not([type="checkbox"])');
    const buttonRule = declarationsFor(styles, ".structured-value-editor button");
    const invalidInputRule = declarationsFor(styles, '.structured-value-editor input[aria-invalid="true"]');

    expect(inputRule.border).toContain("1px solid");
    expect(buttonRule.border).toContain("1px solid");
    // Touch target floor for the add-cell / add-byte / remove controls.
    expect(Number.parseInt(buttonRule["min-height"] ?? "0", 10)).toBeGreaterThanOrEqual(30);
    expect(invalidInputRule["border-color"]).toBeTruthy();
  });
});
