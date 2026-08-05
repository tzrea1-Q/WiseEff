import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ModalDialog portals into document.body, so a dialog is no longer a descendant of
 * `.param-admin-shell` and every rule written that way stops applying to it. That is
 * how the governance confirmations first shipped with unstyled action buttons. These
 * checks keep the backdrop-scoped counterpart of each shared dialog rule in place.
 */
function stylesheet(): string {
  return readFileSync(resolve(__dirname, "../../styles.css"), "utf8");
}

function selectors(styles: string): string[] {
  return styles
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .flatMap((block) => (block.includes("{") ? block.slice(0, block.indexOf("{")).split(",") : []))
    .map((selector) => selector.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

describe("param-admin dialog styling survives the portal", () => {
  it("mirrors shell-scoped button and action rules onto the dialog backdrop", () => {
    const all = selectors(stylesheet());
    const shellScoped = all.filter(
      (selector) =>
        selector.startsWith(".param-admin-shell ") &&
        /^(?:\.button|\.dialog-actions|button:focus-visible|input:focus-visible)/.test(
          selector.slice(".param-admin-shell ".length)
        )
    );

    expect(shellScoped.length).toBeGreaterThan(4);

    const missing = shellScoped.filter(
      (selector) =>
        !all.includes(
          `.param-admin-modal-backdrop ${selector.slice(".param-admin-shell ".length)}`
        )
    );

    expect(missing).toEqual([]);
  });

  it("gives the governance confirmation its own spacing instead of inheriting the page's", () => {
    const rule =
      stylesheet().match(/\.governance-confirm-dialog[^{}]*\{[^}]*\}/)?.[0] ?? "";

    expect(rule).toMatch(/display:\s*grid/);
    expect(rule).toMatch(/gap:/);
  });
});
