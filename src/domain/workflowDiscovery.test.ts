import { describe, expect, it } from "vitest";
import {
  homepageFlowIntro,
  homepageFlowTitle,
  homepageHeroWorkflowPhrase,
  isDiscoveryGroupVisible,
  isWorkflowVisible,
  VISIBLE_WORKFLOWS,
  WORKFLOW_IDS
} from "./workflowDiscovery";

describe("workflow discovery visibility", () => {
  it("allows only parameter management and debugging on the first allowlist", () => {
    expect(VISIBLE_WORKFLOWS).toEqual(["parameter-management", "debugging"]);
    expect(WORKFLOW_IDS).toEqual(["parameter-management", "debugging", "log-analysis", "knowledge"]);
    expect(isWorkflowVisible("parameter-management")).toBe(true);
    expect(isWorkflowVisible("debugging")).toBe(true);
    expect(isWorkflowVisible("log-analysis")).toBe(false);
    expect(isWorkflowVisible("knowledge")).toBe(false);
  });

  it("keeps overview nav visible and hides unfinished workflow groups", () => {
    expect(isDiscoveryGroupVisible("平台总览")).toBe(true);
    expect(isDiscoveryGroupVisible("参数管理")).toBe(true);
    expect(isDiscoveryGroupVisible("调试平台")).toBe(true);
    expect(isDiscoveryGroupVisible("日志分析")).toBe(false);
    expect(isDiscoveryGroupVisible("知识库")).toBe(false);
  });

  it("names only visible workflows in homepage offer copy", () => {
    expect(homepageHeroWorkflowPhrase()).toBe("参数管理和设备调试");
    expect(homepageFlowTitle()).toBe("一条可审阅工作流，两种场景接入");
    expect(homepageFlowIntro()).toBe(
      "把参数管理和设备调试压缩进同一个可核对视图，保留 Agent 辅助与人工确认的边界。"
    );
  });
});
