import { describe, expect, it } from "vitest";
import { createAgentPlan, getPageByPath, navigationItems, utilityItems } from "./appConfig";

describe("WiseEff prototype configuration", () => {
  it("exposes the full PRD route map", () => {
    expect(navigationItems.map((item) => item.path)).toEqual([
      "/",
      "/parameter-home",
      "/parameters",
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

    expect(homePage.title).toBe("雷泽");
    expect(homePage.subtitle).toBe("业务流程里的 AI 协同工作系统");
  });

  it("exposes a dedicated log analysis dashboard route", () => {
    const page = getPageByPath("/log-dashboard");

    expect(page.key).toBe("log-dashboard");
    expect(page.label).toBe("看板");
    expect(page.group).toBe("日志分析");
  });

  it("labels the parameter homepage as the user workbench without changing the log dashboard label", () => {
    const parameterHome = getPageByPath("/parameter-home");
    const logDashboard = getPageByPath("/log-dashboard");

    expect(parameterHome.label).toBe("我的工作台");
    expect(parameterHome.group).toBe("参数管理");
    expect(parameterHome.title).toBe("我的工作台");
    expect(parameterHome.subtitle).toBe("待办事项 · 主要功能 · 热榜");
    expect(logDashboard.label).toBe("看板");
    expect(logDashboard.group).toBe("日志分析");
  });

  it("exposes a dedicated node debugging route", () => {
    const page = getPageByPath("/node-debugging");
    expect(page.key).toBe("node-debugging");
    expect(page.label).toBe("节点调试");
    expect(page.group).toBe("调试平台");

    const plan = createAgentPlan("/node-debugging");
    expect(plan.contextTitle).toContain("节点");
  });
  it("resolves the shared user permissions route outside the main navigation map", () => {
    const page = getPageByPath("/user-permissions");

    expect(page.key).toBe("user-permissions");
    expect(page.path).toBe("/user-permissions");
    expect(navigationItems.map((item) => item.path)).not.toContain("/user-permissions");
  });

  it("keeps the retired comparison route resolvable outside normal navigation", () => {
    const page = getPageByPath("/parameter-comparison");
    const plan = createAgentPlan("/parameter-comparison");

    expect(navigationItems.map((item) => item.path)).not.toContain("/parameter-comparison");
    expect(page.key).toBe("parameter-comparison");
    expect(page.path).toBe("/parameter-comparison");
    expect(page.title).toBe("页面不可用");
    expect(plan.contextTitle).not.toContain("对比");
    expect(plan.actions.map((action) => action.id)).not.toContain("summarize-comparison");
    expect(plan.actions.map((action) => action.id)).not.toContain("sync-comparison");
    expect(plan.prompts.join(" ")).not.toContain("同步");
  });

  it("makes user management a utility route to user permissions", () => {
    const userManagement = utilityItems.find((item) => item.label.includes("用户管理") || item.label.includes("鐢ㄦ埛绠＄悊"));

    expect(userManagement?.path).toBe("/user-permissions");
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

  it("declares permissions for configured mutating Agent actions", () => {
    const plans = [
      { path: "/parameters", plan: createAgentPlan("/parameters") },
      { path: "/parameter-review", plan: createAgentPlan("/parameter-review") },
      { path: "/logs", plan: createAgentPlan("/logs") },
      { path: "/debugging", plan: createAgentPlan("/debugging") },
      { path: "/node-debugging", plan: createAgentPlan("/node-debugging") },
      { path: "/parameter-admin", plan: createAgentPlan("/parameter-admin") },
      { path: "/log-admin", plan: createAgentPlan("/log-admin") },
      { path: "/debugging-admin", plan: createAgentPlan("/debugging-admin") }
    ];
    const expectedPermissions = new Map([
      ["draft-parameter-change", "parameter.edit"],
      ["advance-review", "parameter.review"],
      ["merge-review", "parameter.merge"],
      ["connect-device", "debugging.use"],
      ["push-debug-value", "debugging.use"],
      ["scan-orphans", "admin.access"],
      ["draft-cleanup", "admin.access"],
      ["preview-import", "admin.access"],
      ["summarize-audit", "admin.access"]
    ]);

    for (const { path, plan } of plans) {
      const advanceLogPermission = path === "/log-admin" ? "admin.access" : "logs.upload";
      for (const action of plan.actions) {
        const expectedPermission = action.id === "advance-log" ? advanceLogPermission : expectedPermissions.get(action.id);
        if (expectedPermission) {
          expect((action as { requiredPermission?: string }).requiredPermission).toBe(expectedPermission);
        }
      }
    }
  });
});
