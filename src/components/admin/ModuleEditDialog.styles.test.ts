import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "../../test/cssAssertions";

describe("ModuleEditDialog driver-group layout", () => {
  it("uses a consistent section stack and gives the category picker visible chrome", () => {
    const styles = readStylesheet("src/styles.css");
    const body = declarationsFor(
      styles,
      ".param-admin-module-edit-dialog .param-admin-module-edit-body"
    );
    const section = declarationsFor(
      styles,
      ".param-admin-module-edit-dialog .module-edit-section"
    );
    const picker = declarationsFor(
      styles,
      ".module-edit-placement-controls .module-tree-trigger"
    );

    expect(body.display).toBe("flex");
    expect(body["flex-direction"]).toBe("column");
    expect(body.gap).toBeTruthy();
    expect(section.border).toBeTruthy();
    expect(section.padding).toBeTruthy();
    expect(section["border-radius"]).toBe("var(--radius-md)");
    expect(picker.border).toBeTruthy();
    expect(picker.background).toBe("var(--surface)");
    expect(picker["border-radius"]).toBe("var(--radius-md)");
    expect(picker["min-height"]).toBeTruthy();
  });

  it("lays out driver properties as readable full-width fields", () => {
    const styles = readStylesheet("src/styles.css");
    const grid = declarationsFor(
      styles,
      ".organization-driver-schema-dialog__field-grid"
    );
    const field = declarationsFor(
      styles,
      ".organization-driver-schema-dialog__field-grid > label"
    );
    const control = declarationsFor(
      styles,
      ".organization-driver-schema-dialog__field-grid > label > select"
    );

    expect(grid.display).toBe("grid");
    expect(grid["grid-template-columns"]).toBe("repeat(2, minmax(0, 1fr))");
    expect(field.display).toBe("grid");
    expect(field.gap).toBeTruthy();
    expect(control.width).toBe("100%");
    expect(control["min-width"]).toBe("0");
  });

  it("stacks driver properties on narrow screens", () => {
    const styles = readStylesheet("src/styles.css");
    const grid = declarationsFor(
      styles,
      ".organization-driver-schema-dialog__field-grid",
      { within: "max-width: 640px" }
    );

    expect(grid["grid-template-columns"]).toBe("minmax(0, 1fr)");
  });
});
