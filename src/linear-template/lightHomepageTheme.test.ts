import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { declarationFor, declarationsFor, readStylesheet } from "../test/cssAssertions";
import { LinearTemplateHome } from "./LinearTemplateHome";

const cssText = readStylesheet("src/linear-template/linear-template.css");
const homeSource = readFileSync("src/linear-template/LinearTemplateHome.tsx", "utf8");

describe("WiseEff mature homepage theme", () => {
  it("keeps the page foundation light and the three entry cards restrained", () => {
    const card = declarationsFor(cssText, ".sub-app-card");
    const hoverCard = declarationsFor(cssText, ".sub-app-card:hover");

    expect(declarationFor(cssText, ".linear-template-home", "background")).toBe("#fbfcff");
    expect(declarationFor(cssText, ".linear-page-gradient", "background")).toContain(
      "linear-gradient(180deg, #fbfcff 0%, #f4f7ff 56%, #fbfcff 100%)"
    );
    expect(card["border-radius"]).toBe("8px");
    expect(card.background).toContain("#ffffff");
    expect(card["box-shadow"]).toBeTruthy();
    expect(card["min-height"]).toBe("328px");
    expect(card.transition).toContain("transform var(--duration-base) var(--ease-out)");
    expect(hoverCard.transform).toContain("translateY(-4px)");
    expect(hoverCard["border-color"]).toContain("var(--sub-app-accent)");
    expect(declarationFor(cssText, ".sub-app-card-icon", "box-shadow")).toBeTruthy();
    expect(declarationFor(cssText, ".sub-app-card-kicker", "background")).toBe("var(--surface)");
    expect(declarationFor(cssText, ".sub-app-card-ctas", "border-top")).toContain("1px solid");
    expect(declarationFor(cssText, ".sub-app-card-ctas", "flex-direction")).toBe("column");
    expect(declarationFor(cssText, ".sub-app-card-primary", "background")).toBe(
      "linear-gradient(180deg, #075cd8 0%, var(--linear-primary-blue) 100%)"
    );
    expect(declarationFor(cssText, ".sub-app-card-secondary", "font-weight")).toBe("600");
  });

  it("keeps the workflow band and footer on light surfaces", () => {
    expect(declarationFor(cssText, ".platform-flow-section", "background")).toBe("#f4f7ff");
    expect(declarationFor(cssText, ".platform-flow-tablist", "background")).toBe(
      "color-mix(in srgb, var(--surface) 66%, transparent)"
    );
    expect(declarationFor(cssText, ".platform-flow-preview", "background")).toBe("var(--surface)");
    expect(declarationFor(cssText, ".linear-footer", "background")).toBe("var(--surface)");
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
    const heroTitle = declarationsFor(cssText, ".linear-hero h1");
    const mobileHeroTitle = declarationsFor(cssText, ".linear-hero h1", {
      within: "@media (max-width: 760px)"
    });

    expect(heroTitle["font-size"]).toBe("56px");
    expect(heroTitle["line-height"]).toBe("1.08");
    expect(heroTitle["letter-spacing"]).toBe("0");
    expect(mobileHeroTitle["font-size"]).toBe("36px");
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
