import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "../../test/cssAssertions";

describe("ParameterSpecDetailDialog chrome styles (Batch 4)", () => {
  it("separates the editor scroll body from the action bar (SE-18)", () => {
    const styles = readStylesheet("src/styles.css");
    const body = declarationsFor(styles, ".param-admin-editor-dialog-body");
    const actions = declarationsFor(styles, ".param-admin-editor-dialog .dialog-actions");

    expect(body.overflow).toBe("auto");
    expect(body["scroll-padding-bottom"]).toBe("var(--space-4)");
    expect(actions["border-top"]).toBe("1px solid var(--border)");
    expect(actions["flex-shrink"]).toBe("0");
  });

  it("spaces the cutover panel with tokens instead of inline styles (SE-22)", () => {
    const styles = readStylesheet("src/styles.css");
    const panel = declarationsFor(styles, ".param-admin-cutover-panel");
    const finalize = declarationsFor(styles, ".param-admin-cutover-panel__finalize");

    expect(panel["margin-bottom"]).toBe("var(--space-4)");
    expect(finalize["margin-top"]).toBe("var(--space-3)");
  });

  it("stacks nested confirms on the shared nested backdrop token (SE-17, SE-R5)", () => {
    const nested = declarationsFor(
      readStylesheet("src/styles.css"),
      ".modal-backdrop.param-admin-modal-backdrop--nested",
    );
    expect(nested["z-index"]).toBe("var(--z-modal-backdrop-nested)");
  });
});
