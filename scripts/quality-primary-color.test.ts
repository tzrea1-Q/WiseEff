import { describe, expect, it } from "vitest";

import { requirePrimaryActionColors } from "../e2e/quality/primary-color";

describe("primary action consistency", () => {
  it("rejects a Bridge CTA using the pressed color at rest", () => {
    expect(() => requirePrimaryActionColors({
      primaryActions: [{ dom: "button.local-device-bridge-panel__install-cta", role: "button", height: 36,
        background: "rgb(0, 61, 155)", primaryColor: "rgb(0, 82, 204)" }]
    }, "/node-debugging")).toThrow("/node-debugging: button.local-device-bridge-panel__install-cta resting background rgb(0, 61, 155) must equal primary rgb(0, 82, 204)");
  });

  it.each(["rgb(0, 82, 204)", "rgb(76, 141, 255)"])("accepts every primary action matching the theme token %s", (primaryColor) => {
    expect(() => requirePrimaryActionColors({
      primaryActions: ["button.button.primary", "a.local-device-bridge-panel__install-cta", "button.bg-primary"].map((dom) => ({
        dom, role: "button", height: 32, background: primaryColor, primaryColor
      }))
    }, "/dts-reload")).not.toThrow();
  });

  it("checks later actions instead of accepting a matching first action", () => {
    expect(() => requirePrimaryActionColors({
      primaryActions: ["rgb(0, 82, 204)", "rgb(0, 61, 155)"].map((background, index) => ({
        dom: `button.action-${index}`, role: "button", height: 32, background, primaryColor: "rgb(0, 82, 204)"
      }))
    }, "/logs")).toThrow("button.action-1");
  });

  it("rejects an unresolved primary token", () => {
    expect(() => requirePrimaryActionColors({
      primaryActions: [{ dom: "button.primary", role: "button", height: 32, background: "", primaryColor: "" }]
    }, "/knowledge")).toThrow("primary");
  });
});
