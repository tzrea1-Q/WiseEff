import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { LinearTemplateHome } from "./LinearTemplateHome";

const cssText = readFileSync("src/linear-template/linear-template.css", "utf8");
const homeSource = readFileSync("src/linear-template/LinearTemplateHome.tsx", "utf8");

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
    expect(page).toContain("#f7faff");
    expect(page).not.toContain("#edf4ff 48%");
    expect(page).not.toContain("var(--linear-bg)");
  });

  it("avoids saturated gradient transitions below hero and product copy", () => {
    const heroGlow = getCssRule(".linear-hero-glow");

    expect(heroGlow).toContain("radial-gradient");
    expect(heroGlow).not.toContain("conic-gradient");
    expect(heroGlow).not.toContain("animation: linearImageGlow");
    expect(cssText).not.toContain("@keyframes linearImageGlow");
    expect(cssText).not.toContain(".wiseeff-preview::after");
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

  it("uses light surfaces for feature, product, and footer sections", () => {
    expect(getCssRule(".linear-unlike")).toContain("#101c2d");
    expect(getCssRule(".linear-tool-card")).toContain("#ffffff");
    expect(getCssRule(".linear-product-section")).toContain("#fbfcff");
    expect(getCssRule(".wiseeff-preview")).toContain("#ffffff");
    expect(getCssRule(".linear-feature-card")).toContain("#ffffff");
    expect(getCssRule(".linear-footer")).toContain("#ffffff");
  });

  it("removes the proof statistics strip between the hero and Agent section", () => {
    expect(homeSource).not.toContain("proofStats");
    expect(homeSource).not.toContain("<ProofStrip />");
    expect(homeSource).not.toContain("function ProofStrip");
    expect(cssText).not.toContain(".linear-proof-strip");
    expect(cssText).not.toContain(".linear-proof-grid");
  });

  it("keeps product section headings and summary copy on a clean light background", () => {
    const productHeading = getCssRule(".linear-feature-main h2");

    expect(homeSource).not.toContain("linear-feature-aura");
    expect(cssText).not.toContain(".linear-feature-aura");
    expect(cssText).not.toContain(".linear-product-section::after");
    expect(productHeading).toContain("background: transparent");
  });

  it("links the homepage navigation to workbench application pages", () => {
    const { container } = render(createElement(LinearTemplateHome));
    const nav = container.querySelector(".linear-nav");
    const links = Array.from(nav?.querySelectorAll("a") ?? []).map((link) => ({
      label: link.textContent,
      href: link.getAttribute("href")
    }));

    expect(links).toEqual([
      { label: "参数管理", href: "/parameter-home" },
      { label: "日志分析", href: "/logs" },
      { label: "参数调试", href: "/debugging" }
    ]);
    expect(nav).not.toHaveTextContent("参数审阅");
    expect(nav?.querySelector('a[href="/parameter-review"]')).not.toBeInTheDocument();
    expect(nav).not.toHaveTextContent("Platform");
    expect(nav).not.toHaveTextContent("Workflow");
    expect(nav).not.toHaveTextContent("Governance");
    expect(nav).not.toHaveTextContent("Scenarios");
    expect(nav?.querySelector('a[href="#platform"]')).not.toBeInTheDocument();
    expect(nav?.querySelector('a[href="#workflow"]')).not.toBeInTheDocument();
    expect(nav?.querySelector('a[href="#agent"]')).not.toBeInTheDocument();
    expect(nav?.querySelector('a[href="#scenarios"]')).not.toBeInTheDocument();
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

  it("removes the goal and evidence cards from the Agent section", () => {
    expect(homeSource).toContain('id="agent"');
    expect(homeSource).not.toContain("keyboard-card");
    expect(homeSource).not.toContain("zap-card");
    expect(homeSource).not.toContain("<KeyboardMock />");
    expect(homeSource).not.toContain("<ZapMock />");
  });

  it("removes the governance showcase section and its dead anchors", () => {
    const { container } = render(createElement(LinearTemplateHome));

    expect(container.querySelector("#governance")).not.toBeInTheDocument();
    expect(container.querySelector('a[href="#governance"]')).not.toBeInTheDocument();
    expect(homeSource).not.toContain("governanceFeatures");
    expect(homeSource).not.toContain('preview="governance"');
    expect(cssText).not.toContain(".wiseeff-preview.governance");
    expect(cssText).not.toContain(".linear-product-section.compact");
  });

  it("removes lower feature cards from product sections", () => {
    expect(homeSource).not.toContain("cards={parameterCards}");
    expect(homeSource).not.toContain("cards={logCards}");
    expect(homeSource).not.toContain("cards={debuggingCards}");
    expect(homeSource).not.toContain("cards={governanceCards}");
  });

  it("keeps the Agent card emblem visually anchored inside the card", () => {
    const logoMock = getCssRule(".linear-logo-light-mock");
    const logo = getCssRule(".linear-logo-light-mock .wiseeff-icon");

    expect(logoMock).toContain("top: -36px");
    expect(logo).toContain("top: 88px");
  });
});
