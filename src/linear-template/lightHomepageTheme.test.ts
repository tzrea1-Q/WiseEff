import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { declarationFor, declarationsFor, readStylesheet } from "../test/cssAssertions";
import { LinearTemplateHome } from "./LinearTemplateHome";

const cssText = readStylesheet("src/linear-template/linear-template.css");

describe("WiseEff mature homepage theme", () => {
  it("keeps the page foundation light and the three entry cards restrained", () => {
    const card = declarationsFor(cssText, ".sub-app-card");
    const hoverCard = declarationsFor(cssText, ".sub-app-card:hover");
    expect(card["border-radius"]).toBe("var(--radius-md)");
    expect(card.background).toContain("var(--surface)");
    expect(card.transition).toContain("transform var(--duration-base) var(--ease-out)");
    expect(hoverCard["border-color"]).toContain("var(--sub-app-accent)");
    expect(declarationFor(cssText, ".sub-app-card-kicker", "background")).toBe("var(--surface)");
    expect(declarationFor(cssText, ".sub-app-card-primary", "background")).toBe(
      "linear-gradient(180deg, #075cd8 0%, var(--linear-primary-blue) 100%)"
    );
  });

  it("keeps the workflow band and footer on light surfaces", () => {
    expect(declarationFor(cssText, ".platform-flow-tablist", "background")).toBe(
      "color-mix(in srgb, var(--surface) 66%, transparent)"
    );
    expect(declarationFor(cssText, ".platform-flow-preview", "background")).toBe("var(--surface)");
    expect(declarationFor(cssText, ".linear-footer", "background")).toBe("var(--surface)");
  });

  it("renders allowlisted sub-app entry cards before the merged platform flow section", () => {
    const { container } = render(createElement(LinearTemplateHome));

    expect(container.querySelectorAll(".sub-app-card")).toHaveLength(2);
    expect(container.querySelector(".sub-app-card-badge")).not.toBeInTheDocument();
    expect(container.querySelector(".sub-app-entry-row")).toBeInTheDocument();
    expect(container.querySelector("#platform-flow")).toBeInTheDocument();
    for (const retiredSelector of [
      ".linear-product-section",
      ".wiseeff-hero-stage",
      ".linear-stars",
      ".linear-unlike",
      ".linear-tool-grid",
      ".command-card",
      ".logo-light-card",
      '#agent',
    ]) {
      expect(container.querySelector(retiredSelector)).not.toBeInTheDocument();
    }
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
      { label: "调试平台", href: "/node-debugging" }
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

});
