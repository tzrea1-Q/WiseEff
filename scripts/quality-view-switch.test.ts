import { describe, expect, it } from "vitest";

import { requireOrganizationViewSwitchStyles } from "../e2e/quality/view-switch";

const signatures = [
  { variant: "section", role: "button", groupRole: "navigation", height: 40, radius: "999px 999px 999px 999px", fontSize: "14px", lineHeight: "22px", fontWeight: "600", background: "rgb(255, 255, 255)", selectedBackground: "rgb(0, 61, 155)" },
  { variant: "tabs", role: "tab", groupRole: "tablist", height: 32, radius: "8px 8px 8px 8px", fontSize: "13px", lineHeight: "20px", fontWeight: "600", background: "rgb(255, 255, 255)", selectedBackground: "rgb(218, 226, 255)" },
  { variant: "toggle", role: "radio", groupRole: "radiogroup", height: 28, radius: "6px 6px 6px 6px", fontSize: "12px", lineHeight: "18px", fontWeight: "600", background: "rgb(247, 249, 252)", selectedBackground: "rgb(255, 255, 255)" }
];

function measurement(style = signatures[0], selected = true) {
  return { ...style, dom: "button.organization-switch", group: "nav.organization", selected,
    background: selected ? style.selectedBackground : style.background };
}

describe("organization view-switch consistency", () => {
  it.each(["/organization", "/organization/members"])("accepts exactly one signature for selected and unselected controls on %s", (path) => {
    expect(() => requireOrganizationViewSwitchStyles({
      viewSwitches: signatures.flatMap((style) => [measurement(style), measurement(style, false)]),
      viewSwitchSignatures: signatures
    }, path)).not.toThrow();
  });

  it.each([
    { height: 43 }, { radius: "10px 10px 10px 10px" }, { fontSize: "16px" },
    { lineHeight: "24px" }, { fontWeight: "700" }, { background: "rgb(0, 82, 204)" },
    { role: "tab" }, { groupRole: "tablist" }
  ])("rejects drift in %j with the route and control", (drift) => {
    expect(() => requireOrganizationViewSwitchStyles({
      viewSwitches: [{ ...measurement(), ...drift }], viewSwitchSignatures: signatures
    }, "/organization")).toThrow("/organization: button.organization-switch must match exactly one view-switch style (matched 0)");
  });

  it("rejects ambiguous signatures instead of accepting the first match", () => {
    expect(() => requireOrganizationViewSwitchStyles({
      viewSwitches: [measurement()], viewSwitchSignatures: [signatures[0], signatures[0], signatures[2]]
    }, "/organization/members")).toThrow("matched 2");
  });

  it("rejects a local override on an unselected control", () => {
    expect(() => requireOrganizationViewSwitchStyles({
      viewSwitches: [{ ...measurement(signatures[1], false), background: "rgb(238, 242, 248)" }], viewSwitchSignatures: signatures
    }, "/organization/members")).toThrow("matched 0");
  });

  it("uses resolved theme fills rather than hard-coded light colors", () => {
    const dark = signatures.map((style) => ({ ...style, background: "rgb(15, 23, 42)", selectedBackground: "rgb(76, 141, 255)" }));
    expect(() => requireOrganizationViewSwitchStyles({ viewSwitches: dark.map((style) => measurement(style)), viewSwitchSignatures: dark }, "/organization")).not.toThrow();
  });

  it.each(["viewSwitches", "viewSwitchSignatures"] as const)("does not silently pass missing %s", (category) => {
    expect(() => requireOrganizationViewSwitchStyles({ viewSwitches: [measurement()], viewSwitchSignatures: signatures, [category]: [] }, "/organization"))
      .toThrow(`missing consistency measurements: ${category}`);
  });

  it("leaves legacy switches on other routes working during expansion", () => {
    expect(() => requireOrganizationViewSwitchStyles({ viewSwitches: [], viewSwitchSignatures: [] }, "/parameters")).not.toThrow();
  });
});
