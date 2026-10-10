import { describe, expect, it } from "vitest";

import { requirePrimaryActionColors } from "../e2e/quality/primary-color";

describe("primary action consistency", () => {
  it.each([true, false])("allows the pale bulk-write background only when disabled=%s", (disabled) => {
    const check = () => requirePrimaryActionColors({
      primaryActions: [{ dom: "button.submit-round-button.debugging-deploy-button", role: "button", height: 38,
        background: "rgb(233, 238, 251)", primaryColor: "rgb(0, 82, 204)", disabled }]
    }, "/node-debugging");

    if (disabled) {
      expect(check).not.toThrow();
    } else {
      expect(check).toThrow("resting background rgb(233, 238, 251) must equal primary");
    }
  });

  it("rejects a Bridge CTA using the pressed color at rest", () => {
    expect(() => requirePrimaryActionColors({
      primaryActions: [{ dom: "button.local-device-bridge-panel__install-cta", role: "button", height: 36,
        background: "rgb(0, 61, 155)", primaryColor: "rgb(0, 82, 204)", disabled: false }]
    }, "/node-debugging")).toThrow("/node-debugging: button.local-device-bridge-panel__install-cta resting background rgb(0, 61, 155) must equal primary rgb(0, 82, 204)");
  });

  it.each(["rgb(0, 82, 204)", "rgb(76, 141, 255)"])("accepts every primary action matching the theme token %s", (primaryColor) => {
    expect(() => requirePrimaryActionColors({
      primaryActions: ["button.button.primary", "a.local-device-bridge-panel__install-cta", "button.bg-primary"].map((dom) => ({
        dom, role: "button", height: 32, background: primaryColor, primaryColor, disabled: false
      }))
    }, "/dts-reload")).not.toThrow();
  });

  it("checks later actions instead of accepting a matching first action", () => {
    expect(() => requirePrimaryActionColors({
      primaryActions: ["rgb(0, 82, 204)", "rgb(0, 61, 155)"].map((background, index) => ({
        dom: `button.action-${index}`, role: "button", height: 32, background, primaryColor: "rgb(0, 82, 204)", disabled: false
      }))
    }, "/logs")).toThrow("button.action-1");
  });

  it("rejects an unresolved primary token", () => {
    expect(() => requirePrimaryActionColors({
      primaryActions: [{ dom: "button.primary", role: "button", height: 32, background: "", primaryColor: "", disabled: false }]
    }, "/knowledge")).toThrow("primary");
  });
});
