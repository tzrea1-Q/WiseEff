import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const cssText = readFileSync("src/linear-template/linear-template.css", "utf8");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCssRule(selector: string) {
  const match = cssText.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, "s"));
  if (!match) {
    throw new Error(`Missing CSS rule for ${selector}`);
  }
  return match[1];
}

function getMediaRule(mediaQuery: string, selector: string) {
  const mediaIndex = cssText.indexOf(mediaQuery);
  if (mediaIndex === -1) {
    throw new Error(`Missing media query for ${mediaQuery}`);
  }

  const scopedCss = cssText.slice(mediaIndex);
  const rule = scopedCss.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, "s"));
  if (!rule) {
    throw new Error(`Missing CSS rule for ${selector} inside ${mediaQuery}`);
  }

  return rule[1];
}

describe("WiseEff light homepage theme", () => {
  it("defines a light page foundation instead of a dark Linear background", () => {
    const root = getCssRule(".linear-template-home");
    const page = getCssRule(".linear-page-gradient");

    expect(root).toContain("--linear-bg: #fbfcff");
    expect(root).toContain("--linear-surface: #ffffff");
    expect(root).toContain("--linear-soft-surface: #f0f3ff");
    expect(root).toContain("--linear-ink-panel: #172033");
    expect(root).not.toContain("--linear-bg: #000212");
    expect(page).toContain("#fbfcff");
    expect(page).toContain("#edf4ff");
    expect(page).not.toContain("var(--linear-bg)");
  });

  it("keeps dark color limited to the softened hero focus panel", () => {
    const heroShell = getCssRule(".linear-hero-image-shell");
    const stageRail = getCssRule(".wiseeff-stage-rail");
    const stageMain = getCssRule(".wiseeff-stage-main");
    const boundaryPanel = getCssRule(".wiseeff-boundary-panel");

    expect(heroShell).toContain("rgba(255, 255, 255, 0.84)");
    expect(stageRail).toContain("#f5f8ff");
    expect(stageMain).toContain("#22304a");
    expect(stageMain).toContain("#172033");
    expect(stageMain).not.toContain("#050718");
    expect(boundaryPanel).toContain("#f5f8ff");
  });

  it("uses light surfaces for proof, feature, product, and footer sections", () => {
    expect(getCssRule(".linear-proof-grid > div")).toContain("#ffffff");
    expect(getCssRule(".linear-unlike")).toContain("#101c2d");
    expect(getCssRule(".linear-tool-card")).toContain("#ffffff");
    expect(getCssRule(".linear-product-section")).toContain("#fbfcff");
    expect(getCssRule(".wiseeff-preview")).toContain("#ffffff");
    expect(getCssRule(".linear-feature-card")).toContain("#ffffff");
    expect(getCssRule(".linear-footer")).toContain("#ffffff");
  });

  it("keeps product section headings on a clean light background", () => {
    const productAura = getCssRule(".linear-feature-aura");
    const sectionOverlay = getCssRule(".linear-product-section::after");
    const productHeading = getCssRule(".linear-feature-main h2");

    expect(productAura).toContain("top: 520px");
    expect(productAura).toContain("rgba(var(--feature-color), 0.07)");
    expect(productAura).not.toContain("rgb(var(--feature-color-dark))");
    expect(sectionOverlay).toContain("rgba(var(--feature-color), 0.035)");
    expect(productHeading).toContain("background: transparent");
  });

  it("keeps primary CTAs readable on the light hero", () => {
    const primaryButton = getCssRule(".linear-button");
    const scopedPrimaryButton = getCssRule(".linear-template-home .linear-button");
    const primaryHover = getCssRule(".linear-button:hover");

    expect(primaryButton).toContain("color: #ffffff");
    expect(scopedPrimaryButton).toContain("color: #ffffff");
    expect(primaryButton).toContain("#0f74ff");
    expect(primaryButton).not.toContain("#0859cb");
    expect(primaryHover).toContain("#2787ff");
  });

  it("separates the governance workflow mock from its heading", () => {
    const commandCard = getCssRule(".command-card");
    const commandMenu = getCssRule(".linear-command-menu-mock");
    const mobileCommandCard = getMediaRule("@media (max-width: 760px)", ".linear-tool-card.command-card");

    expect(commandCard).toContain("padding-top: 360px");
    expect(commandMenu).toContain("top: 46px");
    expect(mobileCommandCard).toContain("padding-top: 340px");
  });

  it("keeps the Agent card emblem visually anchored inside the card", () => {
    const logoMock = getCssRule(".linear-logo-light-mock");
    const logo = getCssRule(".linear-logo-light-mock .wiseeff-icon");

    expect(logoMock).toContain("top: -36px");
    expect(logo).toContain("top: 88px");
  });
});
