import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
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

describe("WiseEff mature homepage theme", () => {
  it("keeps the page foundation light and the three entry cards restrained", () => {
    const root = getCssRule(".linear-template-home");
    const page = getCssRule(".linear-page-gradient");
    const card = getCssRule(".sub-app-card");
    const hoverCard = getCssRule(".sub-app-card:hover");
    const icon = getCssRule(".sub-app-card-icon");
    const kicker = getCssRule(".sub-app-card-kicker");
    const ctas = getCssRule(".sub-app-card-ctas");
    const primary = getCssRule(".sub-app-card-primary");
    const secondary = getCssRule(".sub-app-card-secondary");

    expect(root).toContain("--linear-bg: #fbfcff");
    expect(root).toContain("--linear-surface: #ffffff");
    expect(root).toContain("--linear-soft-surface: #f0f3ff");
    expect(page).toContain("linear-gradient(180deg, #fbfcff 0%, #f4f7ff 56%, #fbfcff 100%)");
    expect(card).toContain("border-radius: 8px");
    expect(card).toContain("#ffffff");
    expect(card).toContain("box-shadow");
    expect(card).toContain("min-height: 328px");
    expect(card).toContain("transform 180ms ease");
    expect(hoverCard).toContain("translateY(-4px)");
    expect(hoverCard).toContain("var(--sub-app-accent)");
    expect(icon).toContain("box-shadow");
    expect(kicker).toContain("background: #ffffff");
    expect(ctas).toContain("border-top: 1px solid");
    expect(ctas).toContain("flex-direction: column");
    expect(primary).toContain("background: linear-gradient(180deg, #075cd8 0%, var(--linear-primary-blue) 100%)");
    expect(secondary).toContain("font-weight: 600");
  });

  it("keeps the workflow band and footer on light surfaces", () => {
    const section = getCssRule(".platform-flow-section");
    const tablist = getCssRule(".platform-flow-tablist");
    const preview = getCssRule(".platform-flow-preview");
    const footer = getCssRule(".linear-footer");

    expect(section).toContain("#f4f7ff");
    expect(section).not.toContain("#0e111a");
    expect(tablist).toContain("background: rgba(255, 255, 255, 0.66)");
    expect(preview).toContain("#ffffff");
    expect(footer).toContain("#ffffff");
  });

  it("renders three sub-app entry cards before the merged platform flow section", () => {
    const { container } = render(createElement(LinearTemplateHome));

    expect(container.querySelectorAll(".sub-app-card")).toHaveLength(3);
    expect(container.querySelector(".sub-app-card-badge")).not.toBeInTheDocument();
    expect(container.querySelector(".sub-app-entry-row")).toBeInTheDocument();
    expect(container.querySelector("#platform-flow")).toBeInTheDocument();
    expect(container.querySelector(".linear-product-section")).not.toBeInTheDocument();
    expect(container.querySelector(".wiseeff-hero-stage")).not.toBeInTheDocument();
  });

  it("links the homepage navigation directly to workbench application pages", () => {
    const { container } = render(createElement(LinearTemplateHome));
    const nav = container.querySelector(".linear-nav");
    const links = Array.from(nav?.querySelectorAll("a") ?? []).map((link) => ({
      label: link.textContent,
      href: link.getAttribute("href")
    }));

    expect(links).toEqual([
      { label: "参数管理", href: "/parameter-home" },
      { label: "调试平台", href: "/node-debugging" },
      { label: "日志分析", href: "/logs" }
    ]);
    expect(nav?.querySelector('a[href="#platform"]')).not.toBeInTheDocument();
    expect(nav?.querySelector('a[href="#workflow"]')).not.toBeInTheDocument();
    expect(nav?.querySelector('a[href="#agent"]')).not.toBeInTheDocument();
    expect(nav?.querySelector('a[href="#scenarios"]')).not.toBeInTheDocument();
  });

  it("keeps header and footer anchors aligned to the new platform flow", () => {
    const { container } = render(createElement(LinearTemplateHome));

    expect(container.querySelector(".linear-login")).toHaveAttribute("href", "#platform-flow");
    expect(container.querySelector(".linear-header-actions .linear-button")).toHaveAttribute("href", "/parameter-home");
    expect(container.querySelectorAll('.linear-footer a[href="#platform-flow"]')).toHaveLength(3);
  });

  it("keeps the hero headline compact for the shortened homepage", () => {
    const heroTitle = getCssRule(".linear-hero h1");
    const mobileHeroTitle = getMediaRule("@media (max-width: 760px)", ".linear-hero h1");

    expect(heroTitle).toContain("font-size: 56px");
    expect(heroTitle).toContain("line-height: 1.08");
    expect(heroTitle).toContain("letter-spacing: 0");
    expect(mobileHeroTitle).toContain("font-size: 36px");
  });

  it("removes retired marketing and carousel components from the homepage source", () => {
    expect(homeSource).not.toContain("WiseEffHeroStage");
    expect(homeSource).not.toContain("StarsDivider");
    expect(homeSource).not.toContain("UnlikeAnyTool");
    expect(homeSource).not.toContain("ProductSection");
    expect(homeSource).not.toContain("CommandMenuMock");
    expect(homeSource).not.toContain("LogoLightMock");
    expect(homeSource).not.toContain('id="agent"');
  });
});
