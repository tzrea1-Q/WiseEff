import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DtsValueType } from "../../application/ports/DtsStructuredRepository";
import { allSelectors, readStylesheet } from "../../test/cssAssertions";
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
      rawText: "[19]",
    },
    "string-list": {
      propertyName: "compatible",
      rawText: '"vendor,device"',
    },
    "phandle-list": {
      propertyName: "interrupt-parent",
      rawText: "<&gpio>",
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
      rawText: '"a", <0x1>',
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
  it("uses the same raw editor styles for every value type", () => {
    const classNames = editorClassNames();

    expect(classNames).toContain("structured-value-editor");
    expect(classNames).toContain("structured-value-mixed");
    expect(classNames).toHaveLength(2);
  });

  it("styles every class the component emits", () => {
    const selectors = allSelectors(readStylesheet("src/styles.css"));
    const unstyled = editorClassNames().filter(
      (className) =>
        !selectors.some((selector) => new RegExp(`\\.${className}(?![\\w-])`).test(selector))
    );

    expect(unstyled).toEqual([]);
  });
});
