import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { SkillWorkspace } from "./SkillWorkspace";
import { mockSkillWorkspace } from "@/infrastructure/mock/logSkills";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import type { SkillWorkspaceRepository, SkillRevision } from "./types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const conflictError = () => new WiseEffApiError("LOG_SKILL_DRAFT_CONFLICT", "stale", {}, "request");
function setup(options: { section?: string; draft?: boolean; apiMode?: boolean; canEdit?: boolean; legacyDescription?: boolean } = {}) {
  const skill = structuredClone(mockSkillWorkspace("skill-charging")!);
  const old: SkillRevision = { ...skill.currentRevision, id: "old", number: 1, status: "superseded", spec: { schemaVersion: "skill/v1", description: "旧描述" } };
  skill.currentRevision = { ...skill.currentRevision, id: "current", number: 2 };
  if (options.legacyDescription) delete skill.currentRevision.spec.description;
  if (options.draft) skill.draft = { ...skill.currentRevision, id: "draft", number: 3, status: "draft", spec: { ...skill.currentRevision.spec, description: "草稿描述" } };
  const repository = {
    getLogSkill: vi.fn(async () => structuredClone(skill)),
    listSkillRevisions: vi.fn(async () => [...(skill.draft ? [skill.draft] : []), skill.currentRevision, old]),
    saveSkillDraft: vi.fn<SkillWorkspaceRepository["saveSkillDraft"]>(async (_id, spec) => {
      const draft: SkillRevision = { ...skill.currentRevision, id: "saved", number: skill.currentRevision.number + 1, status: "draft", spec };
      skill.draft = draft; return draft;
    }),
    discardSkillDraft: vi.fn(async () => { skill.draft = null; }),
    publishSkill: vi.fn<SkillWorkspaceRepository["publishSkill"]>(async () => {
      skill.currentRevision = { ...skill.draft!, status: "published" }; skill.draft = null; return structuredClone(skill);
    }),
    restoreSkillRevision: vi.fn<SkillWorkspaceRepository["restoreSkillRevision"]>(async () => {
      skill.currentRevision = { ...old, id: "restored", number: 3, status: "published" }; return structuredClone(skill);
    }),
    listLogSkills: vi.fn(async () => [{ ...skill, currentRevision: { id: "current", number: 2, publishedAt: skill.currentRevision.publishedAt }, analyses7d: 7, helpfulRate7d: 0.5 }])
  };
  const onPublished = vi.fn();
  const onNavigate = vi.fn();
  function Harness() {
    const [search, setSearch] = useState(`?section=${options.section ?? "overview"}`);
    return <SkillWorkspace skillId="skill-charging" search={search} repository={repository} apiMode={options.apiMode ?? true} canEdit={options.canEdit ?? true}
      onPublished={onPublished} onNavigate={(path) => {
        const apply = () => { onNavigate(path); if (path.includes("?section=")) setSearch(path.slice(path.indexOf("?"))); };
        const decision = requestSettingsLeave();
        if (decision instanceof Promise) void decision.then((allowed) => { if (allowed) apply(); });
        else if (decision) apply();
      }} />;
  }
  render(<Harness />);
  return { skill, repository, onPublished, onNavigate };
}

describe("skill workspace", () => {
  it("shows compact overview facts without leaking the internal skill id", async () => {
    setup();
    await screen.findByRole("textbox", { name: "描述" });
    expect(screen.queryByText("技能标识")).not.toBeInTheDocument();
    expect(screen.queryByText("skill-charging")).not.toBeInTheDocument();
    const configured = screen.getByRole("region", { name: "已配置内容" });
    expect(configured.querySelector("dl")).toHaveClass("skill-facts");
    expect(within(configured).getByText("基础格式").tagName).toBe("DT");
    expect(within(configured).getByText("平台默认充电规则").tagName).toBe("DD");
  });
  it("shows the legacy identity description without marking dirty and preserves an explicit clear", async () => {
    const { repository } = setup({ legacyDescription: true });
    const description = await screen.findByRole("textbox", { name: "描述" });
    expect(description).toHaveValue("充电链路日志分析");
    expect(screen.queryByRole("group", { name: "未发布更改" })).not.toBeInTheDocument();
    fireEvent.change(description, { target: { value: "" } });
    expect(description).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(repository.saveSkillDraft).toHaveBeenCalledWith("skill-charging", expect.objectContaining({ description: "" }), null, "current"));
    expect(description).toHaveValue("");
  });
  it("shows draft bar after editing and publishes the displayed summary with the saved draft id", async () => {
    const { repository, onPublished } = setup();
    const description = await screen.findByRole("textbox", { name: "描述" });
    expect(screen.queryByRole("group", { name: "未发布更改" })).not.toBeInTheDocument();
    fireEvent.change(description, { target: { value: "新描述" } });
    const bar = screen.getByRole("group", { name: "未发布更改" });
    await userEvent.click(within(bar).getByRole("button", { name: "发布" }));
    const dialog = screen.getByRole("dialog", { name: "发布技能" });
    expect(within(dialog).getByLabelText("概览差异")).toHaveTextContent("新描述");
    expect(within(dialog).getByLabelText("变更摘要")).toHaveTextContent("概览 1 项");
    await userEvent.click(within(dialog).getByRole("button", { name: "发布" }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith("已发布 v3"));
    expect(repository.saveSkillDraft).toHaveBeenCalledWith("skill-charging", expect.objectContaining({ description: "新描述" }), null, "current");
    expect(repository.publishSkill).toHaveBeenCalledWith("skill-charging", "saved");
    await waitFor(() => expect(screen.queryByRole("group", { name: "未发布更改" })).not.toBeInTheDocument());
  });
  it("uses the loaded draft base, then the fresh id on a subsequent save", async () => {
    const { repository } = setup({ draft: true });
    fireEvent.change(await screen.findByRole("textbox", { name: "描述" }), { target: { value: "修改一次" } });
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(repository.saveSkillDraft).toHaveBeenCalledWith("skill-charging", expect.objectContaining({ description: "修改一次" }), "draft", "current"));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled());
    fireEvent.change(screen.getByRole("textbox", { name: "描述" }), { target: { value: "修改两次" } });
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(repository.saveSkillDraft).toHaveBeenLastCalledWith("skill-charging", expect.objectContaining({ description: "修改两次" }), "saved", "current"));
  });
  it("shows conflict and reloads only after confirming loss of local edits", async () => {
    const { skill, repository } = setup();
    repository.saveSkillDraft.mockRejectedValueOnce(conflictError());
    fireEvent.change(await screen.findByRole("textbox", { name: "描述" }), { target: { value: "本地修改" } });
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent("草稿已被其他人更新");
    expect(warning).toHaveClass("status-banner");
    expect(warning).toHaveAttribute("data-tone", "warning");
    skill.currentRevision = { ...skill.currentRevision, id: "other-current", number: 3, spec: { schemaVersion: "skill/v1", description: "新发布的描述" } };
    skill.draft = { ...skill.currentRevision, id: "other", number: 4, status: "draft", spec: { schemaVersion: "skill/v1", description: "其他作者" } };
    await userEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(repository.getLogSkill).toHaveBeenCalledTimes(1);
    await userEvent.click(within(screen.getByRole("dialog", { name: "重新加载草稿？" })).getByRole("button", { name: "确认" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "描述" })).toHaveValue("其他作者"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    const dialog = screen.getByRole("dialog", { name: "发布技能" });
    const descriptionRow = within(dialog).getByRole("rowheader", { name: "描述" }).closest("tr")!;
    expect(within(descriptionRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["新发布的描述", "其他作者"]);
    await userEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    fireEvent.change(screen.getByRole("textbox", { name: "描述" }), { target: { value: "新编辑" } });
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(repository.saveSkillDraft).toHaveBeenLastCalledWith("skill-charging", expect.objectContaining({ description: "新编辑" }), "other", "other-current"));
  });
  it("handles stale publication through the same conflict banner", async () => {
    const { repository } = setup({ draft: true });
    repository.publishSkill.mockRejectedValueOnce(conflictError());
    await userEvent.click(await screen.findByRole("button", { name: "发布" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "发布技能" })).getByRole("button", { name: "发布" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("草稿已被其他人更新");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("confirms discard and resets to the publication", async () => {
    const { repository } = setup({ draft: true });
    await userEvent.click(await screen.findByRole("button", { name: "放弃草稿" }));
    expect(repository.discardSkillDraft).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("dialog", { name: "放弃草稿？" })).getByRole("button", { name: "确认" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "未发布更改" })).not.toBeInTheDocument());
    expect(repository.discardSkillDraft).toHaveBeenCalledWith("skill-charging", "draft");
    expect(screen.getByRole("textbox", { name: "描述" })).toHaveValue("充电链路日志分析");
  });
  it("discards local-only edits without calling the server even when another author has since saved a draft", async () => {
    const { skill, repository } = setup();
    fireEvent.change(await screen.findByRole("textbox", { name: "描述" }), { target: { value: "本地修改" } });
    skill.draft = { ...skill.currentRevision, id: "other", status: "draft", spec: { ...skill.currentRevision.spec, description: "其他作者" } };
    await userEvent.click(screen.getByRole("button", { name: "放弃草稿" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "放弃草稿？" })).getByRole("button", { name: "确认" }));
    expect(screen.getByRole("textbox", { name: "描述" })).toHaveValue("充电链路日志分析");
    expect(screen.queryByRole("group", { name: "未发布更改" })).not.toBeInTheDocument();
    expect(repository.discardSkillDraft).not.toHaveBeenCalled();
    expect(repository.getLogSkill).toHaveBeenCalledTimes(1);
    expect(skill.draft.id).toBe("other");
  });
  it("shows the conflict banner when discarding the observed draft loses a race", async () => {
    const { skill, repository } = setup({ draft: true });
    fireEvent.change(await screen.findByRole("textbox", { name: "描述" }), { target: { value: "本地修改" } });
    skill.draft = { ...skill.draft!, id: "other", spec: { schemaVersion: "skill/v1", description: "其他作者" } };
    repository.discardSkillDraft.mockRejectedValueOnce(conflictError());
    await userEvent.click(screen.getByRole("button", { name: "放弃草稿" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "放弃草稿？" })).getByRole("button", { name: "确认" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("草稿已被其他人更新");
    expect(repository.discardSkillDraft).toHaveBeenCalledWith("skill-charging", "draft");
    expect(repository.getLogSkill).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "描述" })).toHaveValue("本地修改");
    expect(skill.draft.id).toBe("other");
  });
  it("compares the previous revision to current, selects the before version from history, and confirms rollback", async () => {
    const { repository, onPublished } = setup({ section: "versions" });
    expect(await screen.findByRole("combobox", { name: "变更前版本" })).toHaveAttribute("data-value", "old");
    expect(screen.getByRole("combobox", { name: "变更后版本" })).toHaveAttribute("data-value", "current");
    const history = screen.getByRole("table", { name: "技能版本历史" });
    const descriptionRow = within(screen.getByLabelText("概览差异")).getByRole("rowheader", { name: "描述" }).closest("tr")!;
    expect(within(descriptionRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["旧描述", "充电链路日志分析"]);
    await userEvent.click(within(history).getByRole("button", { name: "v2" }));
    expect(screen.getByRole("combobox", { name: "变更前版本" })).toHaveAttribute("data-value", "current");
    expect(screen.getByText("两个版本内容相同")).toBeVisible();
    await userEvent.click(within(history).getByRole("button", { name: "v1" }));
    expect(screen.getByRole("combobox", { name: "变更前版本" })).toHaveAttribute("data-value", "old");
    expect(screen.getByRole("combobox", { name: "变更后版本" })).toHaveAttribute("data-value", "current");
    await userEvent.click(screen.getByRole("button", { name: "回滚到此版本" }));
    expect(repository.restoreSkillRevision).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("dialog", { name: "回滚到 v1？" })).getByRole("button", { name: "确认" }));
    await waitFor(() => expect(repository.restoreSkillRevision).toHaveBeenCalledWith("skill-charging", "old"));
    expect(onPublished).toHaveBeenCalledWith("已发布 v3");
  });
  it("explains a server-side draft-exists restore refusal", async () => {
    const { repository } = setup({ section: "versions" });
    repository.restoreSkillRevision.mockRejectedValueOnce(new WiseEffApiError("LOG_SKILL_DRAFT_EXISTS", "draft exists", {}, "req"));
    await userEvent.click(await screen.findByRole("button", { name: "回滚到此版本" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("请先发布或放弃现有草稿");
    expect(error).toHaveClass("status-banner");
    expect(error).toHaveAttribute("data-tone", "danger");
  });
  it("blocks rollback locally when a draft exists", async () => {
    const { repository } = setup({ section: "versions", draft: true });
    await userEvent.click(await screen.findByRole("button", { name: "回滚到此版本" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请先发布或放弃现有草稿");
    expect(repository.restoreSkillRevision).not.toHaveBeenCalled();
  });
  it("keeps future sections disabled and switches freely without dropping local edits", async () => {
    const { onNavigate } = setup();
    fireEvent.change(await screen.findByRole("textbox", { name: "描述" }), { target: { value: "未保存" } });
    expect(screen.getByRole("button", { name: /诊断流程/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "版本" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onNavigate).toHaveBeenCalledWith("/log-admin/skills/skill-charging?section=versions");
    expect(screen.getByRole("group", { name: "未发布更改" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "概览" }));
    expect(screen.getByRole("textbox", { name: "描述" })).toHaveValue("未保存");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("uses the app leave guard and beforeunload for unsaved edits", async () => {
    setup();
    fireEvent.change(await screen.findByRole("textbox", { name: "描述" }), { target: { value: "未保存" } });
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    let decision: boolean | Promise<boolean> = false;
    // requestSettingsLeave is the same event used by the app router.
    act(() => { decision = requestSettingsLeave(); });
    await userEvent.click(within(screen.getByRole("dialog", { name: "放弃未保存的更改？" })).getByRole("button", { name: "取消" }));
    await expect(decision).resolves.toBe(false);
  });
  it.each([{ apiMode: false }, { canEdit: false }])("keeps mock and viewer authoring disabled: %j", async (options) => {
    const { repository } = setup(options);
    expect(await screen.findByRole("textbox", { name: "描述" })).toBeDisabled();
    expect(screen.getByText(/仅供查看/)).toBeInTheDocument();
    expect(repository.saveSkillDraft).not.toHaveBeenCalled();
  });
  it("renders the standard missing state for an inaccessible id", async () => {
    render(<SkillWorkspace skillId="missing" search="" apiMode={false} canEdit={false} onNavigate={vi.fn()} onPublished={vi.fn()} />);
    expect(await screen.findByText("未找到分析技能")).toBeVisible();
    expect(screen.getByRole("button", { name: "返回分析技能" })).toBeEnabled();
  });
});
