import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet, rulesFor } from "./test/cssAssertions";

const styles = [
  "src/styles.css",
  "src/components/ui/view-switch.css",
  "src/features/log-analysis/log-analysis.css",
  "src/features/parameter-home/parameter-home.css",
  "src/components/project-configuration-workbench/configuration-workbench.css"
].map(readStylesheet).join("\n");

type Color = [number, number, number, number];

function mixColors(foreground: Color, background: Color, weight: number): Color {
  const alpha = foreground[3] * weight + background[3] * (1 - weight);
  return [0, 1, 2].map((channel) => alpha === 0 ? 0 :
    (foreground[channel] * foreground[3] * weight + background[channel] * background[3] * (1 - weight)) / alpha
  ).concat(alpha) as Color;
}

function resolveColor(value: string, tokens: Record<string, string>): Color {
  const variable = /^var\((--[\w-]+)(?:,.*)?\)$/.exec(value);
  if (variable) return resolveColor(tokens[variable[1]], tokens);
  const hex = /^#([\da-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map((start) => parseInt(hex[1].slice(start, start + 2), 16)).concat(1) as Color;
  if (value === "white") return [255, 255, 255, 1];
  if (value === "transparent") return [0, 0, 0, 0];
  const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgb) {
    const channels = rgb[1].split(",").map(Number);
    return [channels[0], channels[1], channels[2], channels[3] ?? 1];
  }
  const mixed = /^color-mix\(in srgb, (.*)\)$/.exec(value);
  if (mixed) {
    let depth = 0;
    const separator = [...mixed[1]].findIndex((character) => {
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      return character === "," && depth === 0;
    });
    const parts = [mixed[1].slice(0, separator), mixed[1].slice(separator + 1)].map((part) => {
      const percentage = /^(.*) ([\d.]+)%$/.exec(part.trim());
      return { value: percentage?.[1] ?? part.trim(), weight: percentage ? Number(percentage[2]) / 100 : undefined };
    });
    const firstWeight = parts[0].weight ?? 1 - (parts[1].weight ?? 0.5);
    const secondWeight = parts[1].weight ?? 1 - firstWeight;
    return mixColors(resolveColor(parts[0].value, tokens), resolveColor(parts[1].value, tokens),
      firstWeight / (firstWeight + secondWeight));
  }
  throw new Error(`Unsupported contrast color: ${value}`);
}

function luminance(color: Color) {
  const channels = color.slice(0, 3).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function composite(foreground: Color, background: Color): Color {
  return mixColors([foreground[0], foreground[1], foreground[2], 1], background, foreground[3]);
}

function expectReadable(foreground: string, background: string | Color, tokens: Record<string, string>) {
  const backgroundColor = typeof background === "string" ? resolveColor(background, tokens) : background;
  const foregroundColor = composite(resolveColor(foreground, tokens), backgroundColor);
  const lighter = Math.max(luminance(foregroundColor), luminance(backgroundColor));
  const darker = Math.min(luminance(foregroundColor), luminance(backgroundColor));
  expect((lighter + 0.05) / (darker + 0.05)).toBeGreaterThanOrEqual(4.5);
}

describe.each(["light", "dark"])("%s theme contrast pairs", (theme) => {
  const tokens = {
    ...declarationsFor(styles, ":root"),
    ...(theme === "dark" ? declarationsFor(styles, ".dark") : {})
  };

  it("keeps the log trend note readable on its sunken panel", () => {
    expectReadable(declarationsFor(styles, ".topic-trend-note").color, "var(--surface-sunken)", tokens);
  });

  it("keeps the debug coverage badge readable on its tinted surface", () => {
    const badge = declarationsFor(styles, ".debug-admin-coverage-badge");
    expectReadable(badge.color, badge.background, tokens);
  });

  it("keeps the unselected hotspot toggle readable", () => {
    const toggle = declarationsFor(styles, ".view-switch__item");
    const group = declarationsFor(styles, ".view-switch--toggle");
    expectReadable(toggle.color, toggle.background, { ...tokens, ...group });
  });

  it.each(["--bg", "--surface", "--surface-raised", "--surface-sunken", "--surface-low", "--surface-mid", "--surface-high", "--accent-soft"])(
    "keeps muted metadata readable on %s",
    (surface) => expectReadable("var(--text-muted)", `var(${surface})`, tokens)
  );

  it("keeps the working configuration chip readable", () => {
    const chip = declarationsFor(styles, ".configuration-workbench__working");
    expectReadable(chip.color, chip.background, tokens);
  });

  it.each(["success", "warning", "danger", "info"])("keeps %s status text readable on its soft tint", (status) => {
    expectReadable(`var(--${status})`, `var(--${status}-soft)`, tokens);
  });

  it("keeps standalone source line numbers readable", () => {
    const gutter = declarationsFor(styles, ".project-primary-dts-viewer__line-number");
    const body = declarationsFor(styles, ".project-primary-dts-viewer__body");
    expectReadable(gutter.color, composite(resolveColor(gutter.background, tokens), resolveColor(body.background, tokens)), tokens);
  });

  it.each(["default", "focused", "hovered"])("keeps %s dark source line numbers readable", (state) => {
    const canvas = declarationsFor(styles, ".configuration-workbench__source");
    const sourceTokens = { ...tokens, ...canvas };
    const gutter = declarationsFor(styles, ".configuration-workbench__source .project-primary-dts-viewer__line-number");
    let background = resolveColor(canvas.background, sourceTokens);
    if (state !== "default") {
      const selector = state === "focused"
        ? ".configuration-workbench__source .project-primary-dts-viewer__line.is-focused"
        : ".configuration-workbench__code-line:hover";
      background = composite(resolveColor(declarationsFor(styles, selector).background, sourceTokens), background);
    }
    expectReadable(gutter.color, background, sourceTokens);
    expectReadable(declarationsFor(styles, ".configuration-workbench__line-number").color, background, sourceTokens);
  });

  it.each(["--configuration-source-text", "--configuration-source-text-muted", "--configuration-source-text-secondary", "--configuration-source-text-strong"])(
    "keeps %s readable on the source canvas and header",
    (foreground) => {
      expectReadable(`var(${foreground})`, "var(--configuration-source-surface)", tokens);
      expectReadable(`var(${foreground})`, "var(--configuration-source-surface-raised)", tokens);
    }
  );

  it("keeps source diff text readable", () => {
    const diff = declarationsFor(styles, ".configuration-workbench__diff");
    expectReadable(diff.color, diff.background, tokens);
  });

  it.each(["default", "active"])("keeps %s source search matches readable inside and outside the workbench", (state) => {
    const selector = ".project-primary-dts-viewer__find-match";
    for (const scope of ["", ".configuration-workbench__source "]) {
      const matchingRules = [selector, `${scope}${selector}`,
        ...(state === "active" ? [`${selector}.is-active`, `${scope}${selector}.is-active`] : [])]
        .flatMap((target) => rulesFor(styles, target));
      const mark = Object.assign({}, ...matchingRules.map((rule) => rule.declarations)) as Record<string, string>;
      const foreground = scope ? "var(--configuration-source-text)" : "var(--text-secondary)";
      const background = scope ? "var(--configuration-source-surface)" : "var(--surface-sunken)";
      const highlight = composite(resolveColor(mark.background, tokens), resolveColor(background, tokens));
      expectReadable(mark.color === "inherit" ? foreground : mark.color, highlight, tokens);
    }
  });
});
