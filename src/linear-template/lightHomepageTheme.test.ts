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

describe("WiseEff light homepage theme", () => {
  it("defines a light page foundation instead of a dark Linear background", () => {
    const root = getCssRule(".linear-template-home");
    const page = getCssRule(".linear-page-gradient");

    expect(root).toContain("--linear-bg: #fbfcff");
    expect(root).toContain("--linear-surface: #ffffff");
    expect(root).toContain("--linear-soft-surface: #f0f3ff");
    expect(root).not.toContain("--linear-bg: #000212");
    expect(page).toContain("#fbfcff");
    expect(page).toContain("#f7faff");
    expect(page).not.toContain("var(--linear-bg)");
  });

  it("renders three sub-app entry cards before the merged platform flow section", () => {
    const { container } = render(createElement(LinearTemplateHome));

    expect(container.querySelectorAll(".sub-app-card")).toHaveLength(3);
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
      { label: "日志分析", href: "/logs" },
      { label: "参数调试", href: "/debugging" }
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

  it("styles sub-app cards as compact dark entry surfaces", () => {
    const card = getCssRule(".sub-app-card");
    const title = getCssRule(".sub-app-card-title");
    const primary = getCssRule(".sub-app-card-primary");

    expect(card).toContain("min-height: 320px");
    expect(card).toContain("border-radius: 8px");
    expect(card).toContain("linear-gradient");
    expect(title).toContain("font-size: 22px");
    expect(title).toContain("letter-spacing: 0");
    expect(primary).toContain("background: var(--sub-app-accent)");
    expect(primary).toContain("color: #ffffff");
  });

  it("styles platform flow tabs with focus and selected states", () => {
    const section = getCssRule(".platform-flow-section");
    const tab = getCssRule(".platform-flow-tab");
    const activeTab = getCssRule(".platform-flow-tab.active");
    const focusTab = getCssRule(".platform-flow-tab:focus-visible");

    expect(section).toContain("background: #0e111a");
    expect(tab).toContain("min-height: 40px");
    expect(activeTab).toContain("rgba(40, 87, 255, 0.24)");
    expect(focusTab).toContain("outline: 2px solid #50dcff");
  });

  it("keeps the hero headline compact for the shortened homepage", () => {
    const heroTitle = getCssRule(".linear-hero h1");
    const mobileHeroTitle = getMediaRule("@media (max-width: 760px)", ".linear-hero h1");

    expect(heroTitle).toContain("font-size: 64px");
    expect(heroTitle).toContain("line-height: 1.08");
    expect(heroTitle).toContain("letter-spacing: 0");
    expect(mobileHeroTitle).toContain("font-size: 40px");
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
