import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cssText = readFileSync("src/styles.css", "utf8");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function declarationFor(selector: string, property: string) {
  const rule = cssText.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, "s"));
  if (!rule) {
    throw new Error(`Missing CSS rule for ${selector}`);
  }

  const declaration = rule[1].match(new RegExp(`${property}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!declaration) {
    throw new Error(`Missing ${property} declaration for ${selector}`);
  }

  return declaration[1];
}

function hexToRgb(hex: string) {
  const value = hex.slice(1);
  return [0, 2, 4].map((start) => Number.parseInt(value.slice(start, start + 2), 16));
}

function relativeLuminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));

  return (lighter + 0.05) / (darker + 0.05);
}

describe("raw log viewer styles", () => {
  it("keeps raw log table headers above the WCAG AA contrast threshold", () => {
    const foreground = declarationFor(".rawlog-table th", "color");
    const background = declarationFor(".rawlog-table thead", "background");

    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});
