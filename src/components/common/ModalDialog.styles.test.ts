import { describe, expect, it } from "vitest";
import { allSelectors, declarationsFor, hasRule, readStylesheet } from "../../test/cssAssertions";

/**
 * ModalDialog portals into document.body, so a dialog is no longer a descendant of
 * `.param-admin-shell` and every rule written that way stops applying to it. That is
 * how the governance confirmations first shipped with unstyled action buttons.
 * Button chrome now comes from the unscoped `.button` base contract (FA-10), which
 * reaches portaled dialogs by construction; these checks keep (a) that base rule
 * unscoped and (b) a backdrop-scoped twin for every remaining shell-scoped rule.
 */
describe("param-admin dialog styling survives the portal", () => {
  it("styles dialog buttons through the unscoped base contract and mirrors remaining shell rules", () => {
    const styles = readStylesheet("src/styles.css");
    const all = allSelectors(styles);

    expect(hasRule(styles, ".button")).toBe(true);
    expect(hasRule(styles, ".button.primary")).toBe(true);

    const shellScoped = all.filter(
      (selector) =>
        selector.startsWith(".param-admin-shell ") &&
        /^(?:\.button|\.dialog-actions|button:focus-visible|input:focus-visible)/.test(
          selector.slice(".param-admin-shell ".length)
        )
    );

    expect(shellScoped.length).toBeGreaterThan(0);

    const missing = shellScoped.filter(
      (selector) =>
        !all.includes(
          `.param-admin-modal-backdrop ${selector.slice(".param-admin-shell ".length)}`
        )
    );

    expect(missing).toEqual([]);
  });

  it("gives the governance confirmation its own spacing instead of inheriting the page's", () => {
    const dialog = declarationsFor(readStylesheet("src/styles.css"), ".governance-confirm-dialog");

    expect(dialog.display).toBe("grid");
    expect(dialog.gap).toBeTruthy();
  });
});
