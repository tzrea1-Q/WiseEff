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
      "/debugging",
      "/node-debugging",
      "/debugging-admin",
      "/log-dashboard",
      "/logs",
      "/log-admin"
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

  it("exposes a dedicated log analysis dashboard route", () => {
    const page = getPageByPath("/log-dashboard");

    expect(page.key).toBe("log-dashboard");
    expect(page.label).toBe("看板");
    expect(page.group).toBe("日志分析");
  });

  it("exposes a dedicated node debugging route", () => {
    const page = getPageByPath("/node-debugging");
    expect(page.key).toBe("node-debugging");
    expect(page.label).toBe("节点调试");
    expect(page.group).toBe("调试平台");

    const plan = createAgentPlan("/node-debugging");
    expect(plan.contextTitle).toContain("节点");
  });
});

describe("parameter-admin agent plan", () => {
  it("prompts 和 actions 包含四个新 id", () => {
    const plan = createAgentPlan("/parameter-admin");

    expect(plan.contextTitle).toBe("参数治理 Agent");
    expect(plan.actions.map((action) => action.id)).toEqual([
      "scan-orphans",
      "preview-import",
      "summarize-audit",
      "draft-cleanup"
    ]);
    expect(plan.prompts.length).toBe(4);
  });

  it("draft-cleanup requiresConfirm", () => {
    const plan = createAgentPlan("/parameter-admin");

    expect(plan.actions.find((action) => action.id === "draft-cleanup")?.requiresConfirm).toBe(true);
  });
});
