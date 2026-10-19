import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PageRouter } from "./routes";
import { getPageByPath } from "@/appConfig";
import { createPrototypeState } from "@/mockData";
import { mockSkillWorkspace } from "@/infrastructure/mock/logSkills";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { AppRuntime } from "./appRuntime";

afterEach(cleanup);
function renderWorkspace(permissions: string[], missing = false) {
  const skill = mockSkillWorkspace("skill-charging")!;
  const getLogSkill = vi.fn(async () => {
    if (missing) throw new WiseEffApiError("NOT_FOUND", "missing", {}, "req");
    return skill;
  });
  render(<PageRouter page={getPageByPath("/log-admin/skills/skill-charging")} search="?section=overview"
    state={{ ...createPrototypeState(), activeRoleId: "hardware-user" }} dispatch={vi.fn()}
    runtime={{ logAnalysisRepository: { getLogSkill, listSkillRevisions: async () => [skill.currentRevision] } } as unknown as AppRuntime}
    runtimeMode="api" sessionPermissions={permissions} onNavigate={vi.fn()} onFeedback={vi.fn()} DebuggingAdminPage={() => null} />);
  return getLogSkill;
}
it("lets a logs viewer open a read-only workspace", async () => {
  const get = renderWorkspace(["logs:view"]);
  expect(await screen.findByRole("textbox", { name: "描述" })).toBeDisabled();
  expect(get).toHaveBeenCalledWith("skill-charging");
  expect(screen.getByText(/编辑需要技能管理权限/)).toBeVisible();
});
it("enables authoring for a skill administrator", async () => {
  renderWorkspace(["logs:view", "logs:admin-domains"]);
  expect(await screen.findByRole("textbox", { name: "描述" })).toBeEnabled();
});
it("keeps the page gate for users without logs view access", () => {
  const get = renderWorkspace([]);
  expect(screen.getByRole("heading", { name: "无权访问该页面" })).toBeVisible();
  expect(get).not.toHaveBeenCalled();
});
it("shows the standard missing state for unknown or foreign organization ids", async () => {
  renderWorkspace(["logs:view"], true);
  expect(await screen.findByText("未找到分析技能")).toBeVisible();
});
