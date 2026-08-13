import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * GOV-01: the Xiaoze approval card portals to <body>, so it must outrank the
 * chat popup or the scrim buries it. These checks pin the stacking scale and
 * the approval-specific overrides so a future edit cannot silently drop the
 * card back under the popup.
 */
function stylesheet(): string {
  return readFileSync(resolve(__dirname, "../../styles.css"), "utf8");
}

function ruleBlock(styles: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? "";
}

describe("Xiaoze approval card stacking", () => {
  it("declares the approval layer above the chat popup and below the toast", () => {
    const root = stylesheet().match(/:root\s*\{[\s\S]*?\}/)?.[0] ?? "";
    const value = (name: string) => Number(root.match(new RegExp(`${name}:\\s*(\\d+)`))?.[1] ?? "NaN");

    const popup = value("--z-xiaoze-popup");
    const approval = value("--z-xiaoze-approval");
    const toast = value("--z-toast");

    expect(Number.isNaN(approval)).toBe(false);
    expect(approval).toBeGreaterThan(popup);
    expect(toast).toBeGreaterThan(approval);
  });

  it("routes the approval overlay and content through the approval layer", () => {
    const css = stylesheet();

    expect(ruleBlock(css, ".xiaoze-approval-overlay")).toMatch(/z-index:\s*var\(--z-xiaoze-approval\)/);
    expect(ruleBlock(css, ".xiaoze-approval-dialog")).toMatch(/z-index:\s*var\(--z-xiaoze-approval\)/);
  });
});
