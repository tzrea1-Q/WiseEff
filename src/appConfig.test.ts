import { describe, expect, it } from "vitest";
import { getPageByPath, getXiaozeContextSummary, navigationItems, utilityItems } from "./appConfig";

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

  it("returns page-specific Xiaoze context summaries", () => {
    expect(getXiaozeContextSummary("/parameters")).toContain("快充电流");
    expect(getXiaozeContextSummary("/logs")).toContain("日志");
    expect(getXiaozeContextSummary("/node-debugging")).toContain("HDC");
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
    expect(getXiaozeContextSummary("/node-debugging")).toContain("HDC");
  });

  it("resolves the shared user permissions route outside the main navigation map", () => {
    const page = getPageByPath("/user-permissions");

    expect(page.key).toBe("user-permissions");
    expect(page.path).toBe("/user-permissions");
    expect(navigationItems.map((item) => item.path)).not.toContain("/user-permissions");
  });

  it("keeps the retired comparison route resolvable outside normal navigation", () => {
    const page = getPageByPath("/parameter-comparison");

    expect(navigationItems.map((item) => item.path)).not.toContain("/parameter-comparison");
    expect(page.key).toBe("parameter-comparison");
    expect(page.path).toBe("/parameter-comparison");
    expect(page.title).toBe("页面不可用");
    expect(getXiaozeContextSummary("/parameter-comparison")).toContain("已下线");
  });

  it("makes user management a utility route to user permissions", () => {
    const userManagement = utilityItems.find((item) => item.label.includes("用户管理"));

    expect(userManagement?.path).toBe("/user-permissions");
  });

  it("does not expose a disabled Agent utility item", () => {
    expect(utilityItems.map((item) => item.label)).not.toContain("Agent 能力");
  });
});
