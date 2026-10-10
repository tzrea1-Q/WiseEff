import { describe, expect, it } from "vitest";

import { requireViewSwitchStyles } from "../e2e/quality/view-switch";
import { consistencyRoutes } from "../e2e/quality/consistency";

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
  it.each(["/node-debugging", "/dts-reload"])("requires local content tabs on %s", (path) => {
    expect(() => requireViewSwitchStyles({
      viewSwitches: [measurement(signatures[1]), measurement(signatures[1], false)], viewSwitchSignatures: signatures
    }, path)).not.toThrow();
    for (const style of [signatures[0], signatures[2]]) {
      expect(() => requireViewSwitchStyles({
        viewSwitches: [measurement(style)], viewSwitchSignatures: signatures
      }, path)).toThrow("matched 0");
    }
  });
  it.each([
    "/debugging-admin", "/debugging-admin/nodes", "/node-debugging", "/dts-reload",
    "/parameter-admin", "/parameter-admin/specs", "/parameter-admin/specs/identity-mapping",
    "/parameter-admin/modules", "/parameter-admin/modules/queue", "/parameter-admin/modules/registry",
    "/parameter-admin/identity-mapping", "/parameter-admin/spec-review", "/parameter-admin/projects",
    "/parameter-admin/projects/aurora/review-roles", "/parameter-review", "/parameter-submissions"
  ])("rejects legacy styles and requires signatures on ticket #1101 route %s", (path) => {
    expect(() => requireViewSwitchStyles({
      viewSwitches: [{ ...measurement(), height: 43 }], viewSwitchSignatures: signatures
    }, path)).toThrow("matched 0");
    expect(consistencyRoutes.find((route) => route.path === path)?.required).toContain("viewSwitchSignatures");
  });

  it("keeps Bridge installation progress separate without exempting protocol tabs", () => {
    const progress = { ...measurement(), dom: "li.active", group: "ol.local-device-bridge-wizard__steps", role: "listitem", height: 36 };
    expect(() => requireViewSwitchStyles({
      viewSwitches: [measurement(signatures[1]), progress], viewSwitchSignatures: signatures
    }, "/node-debugging")).not.toThrow();
    expect(() => requireViewSwitchStyles({
      viewSwitches: [{ ...measurement(signatures[1]), height: 36 }, progress], viewSwitchSignatures: signatures
    }, "/node-debugging")).toThrow("matched 0");
  });

  it.each(["/organization", "/organization/members"])("accepts exactly one signature for selected and unselected controls on %s", (path) => {
    expect(() => requireViewSwitchStyles({
      viewSwitches: signatures.flatMap((style) => [measurement(style), measurement(style, false)]),
      viewSwitchSignatures: signatures
    }, path)).not.toThrow();
  });

  it.each([
    { height: 43 }, { radius: "10px 10px 10px 10px" }, { fontSize: "16px" },
    { lineHeight: "24px" }, { fontWeight: "700" }, { background: "rgb(0, 82, 204)" },
    { role: "tab" }, { groupRole: "tablist" }
  ])("rejects drift in %j with the route and control", (drift) => {
    expect(() => requireViewSwitchStyles({
      viewSwitches: [{ ...measurement(), ...drift }], viewSwitchSignatures: signatures
    }, "/organization")).toThrow("/organization: button.organization-switch must match exactly one view-switch style (matched 0)");
  });

  it("rejects ambiguous signatures instead of accepting the first match", () => {
    expect(() => requireViewSwitchStyles({
      viewSwitches: [measurement()], viewSwitchSignatures: [signatures[0], signatures[0], signatures[2]]
    }, "/organization/members")).toThrow("matched 2");
  });

  it("rejects a local override on an unselected control", () => {
    expect(() => requireViewSwitchStyles({
      viewSwitches: [{ ...measurement(signatures[1], false), background: "rgb(238, 242, 248)" }], viewSwitchSignatures: signatures
    }, "/organization/members")).toThrow("matched 0");
  });

  it("uses resolved theme fills rather than hard-coded light colors", () => {
    const dark = signatures.map((style) => ({ ...style, background: "rgb(15, 23, 42)", selectedBackground: "rgb(76, 141, 255)" }));
    expect(() => requireViewSwitchStyles({ viewSwitches: dark.map((style) => measurement(style)), viewSwitchSignatures: dark }, "/organization")).not.toThrow();
  });

  it.each(["viewSwitches", "viewSwitchSignatures"] as const)("does not silently pass missing %s", (category) => {
    expect(() => requireViewSwitchStyles({ viewSwitches: [measurement()], viewSwitchSignatures: signatures, [category]: [] }, "/organization"))
      .toThrow(`missing consistency measurements: ${category}`);
  });

  it("leaves legacy switches on other routes working during expansion", () => {
    expect(() => requireViewSwitchStyles({ viewSwitches: [], viewSwitchSignatures: [] }, "/parameters")).not.toThrow();
  });
});
