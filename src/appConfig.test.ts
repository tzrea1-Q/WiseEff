import { describe, expect, it } from "vitest";
import { createAgentPlan, getPageByPath, navigationItems } from "./appConfig";

describe("WiseEff prototype configuration", () => {
  it("exposes the full PRD route map", () => {
    expect(navigationItems.map((item) => item.path)).toEqual([
      "/",
      "/parameter-home",
      "/parameters",
      "/parameter-comparison",
      "/parameter-review",
      "/parameter-admin",
      "/logs",
      "/log-admin",
      "/debugging",
      "/debugging-admin"
    ]);
  });

  it("uses one shared floating Agent shell while changing page context", () => {
    const parameterAgent = createAgentPlan("/parameters");
    const logAgent = createAgentPlan("/logs");

    expect(parameterAgent.shellVariant).toBe("unified-glass-agent");
    expect(logAgent.shellVariant).toBe("unified-glass-agent");
    expect(parameterAgent.contextTitle).toContain("参数");
    expect(logAgent.contextTitle).toContain("日志");
  });

  it("can resolve unknown paths back to the home page", () => {
    expect(getPageByPath("/missing").path).toBe("/");
  });

  it("uses the latest WiseEff brand theme on the home page", () => {
    const homePage = getPageByPath("/");

    expect(homePage.title).toBe("智效 WiseEff");
    expect(homePage.subtitle).toBe("业务流程里的 AI 协同工作系统");
  });
});
