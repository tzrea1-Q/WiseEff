import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The structured value editor shipped every one of its own class names with no rule
 * anywhere in the stylesheet, so the highest-risk write path in the parameter admin
 * rendered as unstyled HTML. Deriving the list from the component means a new
 * sub-editor cannot repeat that silently.
 */
function editorClassNames(): string[] {
  const source = readFileSync(resolve(__dirname, "StructuredValueEditor.tsx"), "utf8");
  const tokens = new Set<string>();
  for (const match of source.matchAll(/className="([^"{}]+)"/g)) {
    for (const token of match[1]!.trim().split(/\s+/)) {
      if (token.startsWith("structured-value")) {
        tokens.add(token);
      }
    }
  }
  return Array.from(tokens).sort();
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
    const styles = readFileSync(resolve(__dirname, "../../styles.css"), "utf8");
    const unstyled = editorClassNames().filter(
      (className) => !new RegExp(`\\.${className}[\\s,.:>{[]`).test(styles)
    );

    expect(unstyled).toEqual([]);
  });

  it("gives the editor's inputs and buttons a visible affordance", () => {
    const styles = readFileSync(resolve(__dirname, "../../styles.css"), "utf8");

    const inputRule =
      styles.match(
        /\.structured-value-editor input:not\(\[type="checkbox"\]\),\s*\.structured-value-editor textarea\s*\{[^}]*\}/
      )?.[0] ?? "";
    const buttonRule =
      styles.match(/\.structured-value-editor button\s*\{[^}]*\}/)?.[0] ?? "";

    expect(inputRule).toMatch(/border:\s*1px solid/);
    expect(buttonRule).toMatch(/border:\s*1px solid/);
    // Touch target floor for the add-cell / add-byte / remove controls.
    expect(buttonRule).toMatch(/min-height:\s*(?:3[0-9]|[4-9][0-9])px/);
    expect(styles).toMatch(
      /\.structured-value-editor input\[aria-invalid="true"\]\s*\{[^}]*border-color/
    );
  });
});
