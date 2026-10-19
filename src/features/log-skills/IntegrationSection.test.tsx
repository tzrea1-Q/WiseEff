import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { IntegrationSection } from "./IntegrationSection";
import { SkillWorkspace } from "./SkillWorkspace";
import { buildSkillUploadExamples } from "./integrationExamples";
import { mockSkillWorkspace } from "@/infrastructure/mock/logSkills";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { SectionProps } from "./SkillWorkspace";
import type { AnalysisSkill, SkillSpec } from "./types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function setup(overrides: Partial<SectionProps> = {}) {
  const skill = { ...mockSkillWorkspace("skill-charging")!, budgetCaps: { stepBudget: 6, tokenBudget: 8000 } };
  const repository = { listLogSkills: vi.fn().mockResolvedValue([]), updateLogDomain: vi.fn().mockResolvedValue({}), ...overrides.repository };
  function Harness() {
    const [current, setCurrent] = useState<AnalysisSkill>(skill);
    const [spec, setSpec] = useState<SkillSpec>(skill.currentRevision.spec);
    return <IntegrationSection skill={current} spec={spec} setSpec={setSpec} disabled={false} sample={null}
      parsingYaml="" onParsingYamlChange={() => undefined} revisions={[]} onRestore={() => undefined} apiMode canEdit dirty={false}
      onSkillUpdated={setCurrent} onBusyChange={() => undefined} {...overrides} repository={repository} />;
  }
  render(<Harness />);
  return { skill, repository };
}

describe("skill integration", () => {
  it("copies the key, endpoint, and both runnable examples with a token placeholder", async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const { skill } = setup();
    const examples = buildSkillUploadExamples(window.location.origin, skill.skillKey);
    await user.click(screen.getByRole("button", { name: "复制技能标识" }));
    expect(copy).toHaveBeenLastCalledWith(skill.skillKey);
    await user.click(screen.getByRole("button", { name: "复制上传地址" }));
    expect(copy).toHaveBeenLastCalledWith(examples.endpoint);
    for (const [kind, label] of [["json", "单文件 JSON / Base64"], ["multipart", "多文件表单"]] as const) {
      await user.click(screen.getByText(label, { selector: "summary" }));
      await user.click(screen.getByRole("button", { name: `复制${label}命令` }));
      expect(copy).toHaveBeenLastCalledWith(examples[kind].curl);
      expect(examples[kind].curl).toContain('Bearer $WISEEFF_TOKEN');
      expect(examples[kind].curl).not.toMatch(/^\+/m);
      expect(examples[kind].curl).toContain(skill.skillKey);
    }
    expect(screen.getByRole("status")).toHaveTextContent("已复制多文件表单");
  });

  it("validates key edits, reports duplicates, and saves without changing the skill revision", async () => {
    const { repository } = setup();
    await userEvent.click(screen.getByRole("button", { name: "编辑技能标识" }));
    fireEvent.change(screen.getByLabelText("技能标识"), { target: { value: "INVALID key" } });
    await userEvent.click(screen.getByRole("button", { name: "保存标识" }));
    expect(screen.getByRole("alert")).toHaveTextContent("2–63");
    expect(repository.updateLogDomain).not.toHaveBeenCalled();
    vi.mocked(repository.updateLogDomain).mockRejectedValueOnce(new WiseEffApiError("VALIDATION_FAILED", "duplicate", { fieldErrors: { skillKey: "duplicate" } }, "req"));
    fireEvent.change(screen.getByLabelText("技能标识"), { target: { value: "charging-new" } });
    await userEvent.click(screen.getByRole("button", { name: "保存标识" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("已被使用");
    await userEvent.click(screen.getByRole("button", { name: "保存标识" }));
    await waitFor(() => expect(screen.queryByLabelText("技能标识")).not.toBeInTheDocument());
    expect(repository.updateLogDomain).toHaveBeenLastCalledWith({ domainId: "skill-charging", skillKey: "charging-new" });
    expect(screen.getByText("charging-new", { selector: "code" })).toBeVisible();
  });

  it("shows server budget cap failures on the relevant fields and keeps the entered draft", async () => {
    const skill = { ...mockSkillWorkspace("skill-charging")!, budgetCaps: { stepBudget: 6, tokenBudget: 8000 } };
    const repository = {
      getLogSkill: vi.fn().mockResolvedValue(skill), listSkillRevisions: vi.fn().mockResolvedValue([skill.currentRevision]),
      listLogSkills: vi.fn().mockResolvedValue([]),
      saveSkillDraft: vi.fn().mockRejectedValue(new WiseEffApiError("VALIDATION_FAILED", "cap", {
        issues: [{ path: ["stepBudget"], message: "Must not exceed platform cap (6)." }, { path: ["tokenBudget"], message: "Must not exceed platform cap (8000)." }]
      }, "req"))
    };
    render(<SkillWorkspace skillId={skill.id} search="?section=integration" repository={repository} apiMode canEdit onNavigate={() => undefined} onPublished={() => undefined} />);
    const steps = await screen.findByLabelText("步骤预算");
    const tokens = screen.getByLabelText("令牌预算");
    fireEvent.change(steps, { target: { value: "7" } });
    fireEvent.change(tokens, { target: { value: "9000" } });
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(steps).toHaveAttribute("aria-invalid", "true"));
    expect(tokens).toHaveAttribute("aria-invalid", "true");
    expect(steps).toHaveValue(7); expect(tokens).toHaveValue(9000);
    expect(steps).toHaveAccessibleDescription(/平台上限：6.*不得超过平台上限/);
  });

  it("keeps key editing and model budgets read-only without skill administrator access", () => {
    setup({ disabled: true, canEdit: false });
    expect(screen.getByRole("button", { name: "编辑技能标识" })).toBeDisabled();
    expect(screen.getByLabelText("模型覆盖")).toBeDisabled();
    expect(screen.getByLabelText("步骤预算")).toBeDisabled();
  });
});
