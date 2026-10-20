import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useState } from "react";
import { SkillWorkspace } from "./SkillWorkspace";
import { mockSkillWorkspace, mockSkillSample } from "@/infrastructure/mock/logSkills";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import type { SkillWorkspaceRepository, SkillRevision, SkillSpec, ParseTestRun, AnalysisCase, AnalysisCaseRun } from "./types";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const conflictError = () => new WiseEffApiError("LOG_SKILL_DRAFT_CONFLICT", "stale", {}, "request");
const parseTest = { id: "parse-test", name: "故障字段", lines: ["ERROR fault=1"], expect: { fields: { fault: 2 } } };
const failedParseRun: ParseTestRun = { passed: 0, total: 1, failed: 1, truncated: false, results: [{ id: parseTest.id, name: parseTest.name, passed: false,
  diffs: [{ path: "fault", expected: 2, actual: 1 }], missingSignals: [], unexpectedSignals: [], events: [], signals: [] }] };
const analysisCase: AnalysisCase = { id: "case", name: "Case", expectations: { domain: "generic", summary: "Case", realLog: false,
  rootCauseCategory: "software-fault", rootCausePoints: ["fault"], keyEvidenceLines: [1], expectedActions: ["inspect"], expectRefusal: false },
  files: [], createdAt: "2026-10-19", updatedAt: "2026-10-19" };
const completeCaseRun: AnalysisCaseRun = { id: "case-run", skillRevisionId: "draft", publishedRevisionId: "current", status: "complete", progress: 100,
  results: [{ caseId: "case", name: "Case", draft: { score: 100, passed: true, traceReference: "trace", report: { confidence: 0.9, conclusion: "fault", impact: "fault",
    severity: "Warning", evidence: [], suggestedActions: ["inspect"], reportContext: { lineCount: 1, entryCount: 1 } } }, published: null, delta: 10 }], error: null, createdAt: "2026-10-19" };
function setup(options: { section?: string; tab?: string; draft?: boolean; apiMode?: boolean; canEdit?: boolean; legacyDescription?: boolean; procedure?: string;
  spec?: Partial<SkillSpec>; runParseTests?: NonNullable<SkillWorkspaceRepository["runSkillParseTests"]>; knowledgeRepository?: KnowledgeRepository } = {}) {
  const skill = structuredClone(mockSkillWorkspace("skill-charging")!);
  const old: SkillRevision = { ...skill.currentRevision, id: "old", number: 1, status: "superseded", spec: { schemaVersion: "skill/v1", description: "旧描述" } };
  skill.currentRevision = { ...skill.currentRevision, id: "current", number: 2 };
  Object.assign(skill.currentRevision.spec, options.spec);
  if (options.procedure !== undefined) skill.currentRevision.spec.procedure = options.procedure;
  if (options.legacyDescription) delete skill.currentRevision.spec.description;
  if (options.draft) skill.draft = { ...skill.currentRevision, id: "draft", number: 3, status: "draft", spec: { ...skill.currentRevision.spec, description: "草稿描述" } };
  const repository = {
    getSkillSample: vi.fn(async () => mockSkillSample),
    getSkillSampleText: vi.fn(async () => null),
    replaceSkillSample: vi.fn(async (_id: string, _file: File) => undefined),
    deleteSkillSample: vi.fn(async () => undefined),
    parsePreview: vi.fn<NonNullable<SkillWorkspaceRepository["parsePreview"]>>(async () => ({ valid: true, truncated: false, issues: [], events: [],
      counts: { total: 0, byExtractor: {}, errors: {} }, unmatchedLineCount: 0 })),
    getLogSkill: vi.fn(async () => structuredClone(skill)),
    ...(options.runParseTests ? { runSkillParseTests: vi.fn(options.runParseTests) } : {}),
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
    listLogSkills: vi.fn(async () => [{ ...skill, currentRevision: { id: "current", number: 2, publishedAt: skill.currentRevision.publishedAt }, analyses7d: 7, helpfulRate7d: 0.5 }]),
    startSkillDryRun: vi.fn(async () => ({ id: "dry-run", skillRevisionId: skill.draft!.id, status: "processing" as const,
      progress: 0, report: null, error: null, createdAt: skill.createdAt })),
    getSkillDryRun: vi.fn(async () => ({ run: { id: "dry-run", skillRevisionId: skill.draft!.id, status: "complete" as const,
      progress: 100, report: null, error: null, createdAt: skill.createdAt }, steps: [] })),
    listAnalysisCases: vi.fn<NonNullable<SkillWorkspaceRepository["listAnalysisCases"]>>(async () => ({ items: [], latestRun: null, current: false })),
    startAnalysisCaseRun: vi.fn<NonNullable<SkillWorkspaceRepository["startAnalysisCaseRun"]>>(async () => ({ id: "case-run", skillRevisionId: skill.draft!.id,
      publishedRevisionId: "current", status: "processing", progress: 0, results: [], error: null, createdAt: skill.createdAt })),
    getAnalysisCaseRun: vi.fn<NonNullable<SkillWorkspaceRepository["getAnalysisCaseRun"]>>(async () => ({ ...completeCaseRun, skillRevisionId: skill.draft!.id })),
    listSourceSnapshots: vi.fn(async () => [{ id: "source-default", skillId: skill.id, versionLabel: "source-v1", status: "ready" as const,
      fileCount: 1, filesProcessed: 1, filesTotal: 1, skippedCount: 0, skippedFiles: [], error: null, createdAt: skill.createdAt }]),
    setDefaultSourceSnapshot: vi.fn<SkillWorkspaceRepository["setDefaultSourceSnapshot"]>(async (_id, snapshotId) => {
      skill.draft = { ...skill.currentRevision, id: "source-draft", number: 3, status: "draft",
        spec: { ...(skill.draft ?? skill.currentRevision).spec, defaultSourceSnapshotId: snapshotId } };
      return structuredClone(skill);
    })
  };
  const onPublished = vi.fn();
  const onNavigate = vi.fn();
  function Harness() {
    const [search, setSearch] = useState(`?section=${options.section ?? "overview"}${options.tab ? `&tab=${options.tab}` : ""}`);
    return <SkillWorkspace skillId="skill-charging" search={search} repository={repository} apiMode={options.apiMode ?? true} canEdit={options.canEdit ?? true}
      knowledgeRepository={options.knowledgeRepository} knowledgeCapability={{ userId: "user", canView: true, canEdit: false, canManage: false }}
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
  it("keeps file applicability beside parsing and saves its ordered roles across sections", async () => {
    const { repository } = setup({ section: "parsing" });
    fireEvent.click(await screen.findByRole("button", { name: "添加文件规则" }));
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "通配模式 1" }), { target: { value: "charger/**" } });
    fireEvent.click(screen.getByRole("button", { name: "文件规则 1 使用角色充电" }));
    fireEvent.click(screen.getByRole("button", { name: "概览" }));
    expect(screen.getByText("1 条规则")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "样例与解析" }));
    expect(screen.getByRole("textbox", { name: "通配模式 1" })).toHaveValue("charger/**");
    expect(screen.getByRole("textbox", { name: "文件角色 1" })).toHaveValue("充电");
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(repository.saveSkillDraft).toHaveBeenCalledWith("skill-charging", expect.objectContaining({ files: [{ glob: "charger/**", role: "充电" }] }), null, "current"));
  });

  it.each(["parse", "cases"])("drops the test tab from other section URLs and restores the remembered tab (%s)", async (tab) => {
    const { onNavigate } = setup({ section: "tests", tab });
    expect(await screen.findByRole("tab", { name: tab === "cases" ? /分析用例/ : /解析测试/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("button", { name: "版本" }));
    expect(onNavigate).toHaveBeenLastCalledWith("/log-admin/skills/skill-charging?section=versions");
    await userEvent.click(screen.getByRole("button", { name: "测试" }));
    expect(onNavigate).toHaveBeenLastCalledWith(`/log-admin/skills/skill-charging?section=tests&tab=${tab}`);
    expect(screen.getByRole("tab", { name: tab === "cases" ? /分析用例/ : /解析测试/ })).toHaveAttribute("aria-selected", "true");
    const next = tab === "cases" ? "parse" : "cases";
    await userEvent.click(screen.getByRole("tab", { name: next === "cases" ? /分析用例/ : /解析测试/ }));
    await userEvent.click(screen.getByRole("button", { name: "概览" }));
    expect(onNavigate).toHaveBeenLastCalledWith("/log-admin/skills/skill-charging?section=overview");
    await userEvent.click(screen.getByRole("button", { name: "测试" }));
    expect(onNavigate).toHaveBeenLastCalledWith(`/log-admin/skills/skill-charging?section=tests&tab=${next}`);
    expect(screen.getByRole("tab", { name: next === "cases" ? /分析用例/ : /解析测试/ })).toHaveAttribute("aria-selected", "true");
  });

  it("uses the shared manual keyboard tabs and preserves their URL selection across sections", async () => {
    const { onNavigate } = setup({ section: "tests" });
    const parse = await screen.findByRole("tab", { name: /解析测试.*未运行/ });
    const cases = screen.getByRole("tab", { name: /分析用例.*未运行/ });
    expect(parse).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: /解析测试/ })).toBeVisible();
    parse.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(cases).toHaveFocus();
    expect(parse).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    expect(onNavigate).toHaveBeenLastCalledWith("/log-admin/skills/skill-charging?section=tests&tab=cases");
    expect(screen.getByRole("tabpanel", { name: /分析用例/ })).toBeVisible();
    expect(screen.queryByRole("tabpanel", { name: /解析测试/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "概览" }));
    await userEvent.click(screen.getByRole("button", { name: "测试" }));
    expect(await screen.findByRole("tab", { name: /分析用例/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: /解析测试/ }));
    expect(onNavigate).toHaveBeenLastCalledWith("/log-admin/skills/skill-charging?section=tests&tab=parse");
  });

  it("shows compact running/pass labels and invalidates results after draft edits", async () => {
    let finish!: (run: ParseTestRun) => void;
    const { repository } = setup({ section: "tests", draft: true, spec: { parseTests: [parseTest] },
      runParseTests: () => new Promise((resolve) => { finish = resolve; }) });
    repository.listAnalysisCases.mockResolvedValue({ items: [analysisCase], latestRun: completeCaseRun, current: true });
    expect(await screen.findByRole("tab", { name: /分析用例.*通过 1 \/ 1/ })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(screen.getByRole("button", { name: "运行测试" }));
    expect(screen.getByRole("tab", { name: /解析测试.*运行中/ })).toBeVisible();
    await act(async () => { finish(failedParseRun); });
    expect(screen.getByRole("tab", { name: /解析测试.*通过 0 \/ 1/ })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "概览" }));
    fireEvent.change(screen.getByRole("textbox", { name: "描述" }), { target: { value: "New draft content" } });
    await userEvent.click(screen.getByRole("button", { name: "测试" }));
    expect(await screen.findByRole("tab", { name: /解析测试.*未运行/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /分析用例.*未运行/ })).toBeVisible();
  });

  it.each([false, true])("does not label stale case runs as current (case set current=%s)", async (current) => {
    const { repository } = setup({ section: "tests", draft: true });
    repository.listAnalysisCases.mockResolvedValue({ items: [analysisCase], latestRun: { ...completeCaseRun, skillRevisionId: current ? "old-draft" : "draft" }, current });
    await screen.findByRole("table", { name: "解析测试列表" });
    await waitFor(() => expect(repository.listAnalysisCases).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: /分析用例.*未运行/ })).toBeVisible();
  });

  it("groups both publication summaries before the diff and deep-links to each tab", async () => {
    const { repository, onNavigate } = setup({ section: "tests", tab: "cases", draft: true,
      spec: { parseTests: [parseTest] }, runParseTests: async () => failedParseRun });
    repository.listAnalysisCases.mockResolvedValue({ items: [analysisCase], latestRun: completeCaseRun, current: true });
    await screen.findByRole("tab", { name: /分析用例.*通过/ });
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    const dialog = screen.getByRole("dialog", { name: "发布技能" });
    const block = within(dialog).getByRole("region", { name: "发布前测试" });
    expect(await within(block).findByText("解析测试：通过 0 / 1")).toBeVisible();
    expect(await within(block).findByText("分析用例：通过 1 / 1（较已发布 +1 / −0）")).toBeVisible();
    expect(within(block).getByText("失败测试：故障字段")).toBeVisible();
    expect(within(dialog).getAllByText("测试结果仅供参考，不阻止发布。")).toHaveLength(1);
    expect(block.compareDocumentPosition(within(dialog).getByLabelText("变更摘要")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(dialog).queryByLabelText("发布提醒")).not.toBeInTheDocument();
    await userEvent.click(within(block).getByRole("button", { name: "查看失败测试" }));
    expect(onNavigate).toHaveBeenLastCalledWith("/log-admin/skills/skill-charging?section=tests&tab=parse");
    expect(screen.getByRole("tab", { name: /解析测试/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("table", { name: "解析测试差异" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    const again = screen.getByRole("dialog", { name: "发布技能" });
    await userEvent.click(await within(again).findByRole("button", { name: "查看分析用例" }));
    expect(onNavigate).toHaveBeenLastCalledWith("/log-admin/skills/skill-charging?section=tests&tab=cases");
    expect(screen.getByRole("tab", { name: /分析用例/ })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the cases tab from an unrun publication summary", async () => {
    const { onNavigate } = setup({ draft: true });
    fireEvent.click(await screen.findByRole("button", { name: "发布" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "发布技能" })).getByRole("button", { name: "运行分析用例" }));
    expect(onNavigate).toHaveBeenLastCalledWith("/log-admin/skills/skill-charging?section=tests&tab=cases");
    expect(screen.getByRole("tab", { name: /分析用例/ })).toHaveAttribute("aria-selected", "true");
  });

  it("adds a selected sample line, runs its parse test and retains the diff across tabs", async () => {
    const { repository } = setup({ section: "tests", spec: { parsing: { schemaVersion: "parsing/v1", extractors: [] } },
      runParseTests: async (_id, spec) => ({ ...failedParseRun, results: [{ ...failedParseRun.results[0], id: spec.parseTests![0].id, name: spec.parseTests![0].name }] }) });
    repository.parsePreview.mockResolvedValue({ valid: true, truncated: false, issues: [], counts: { total: 1, byExtractor: { fault: 1 }, errors: {} }, unmatchedLineCount: 0,
      events: [{ v: 1, source: "declarative", file: "charging.log", line: 1, extractor: "fault", fields: { fault: 1 } }] });
    await userEvent.click(await screen.findByRole("button", { name: /选择样例第 2 行/ }));
    await userEvent.click(screen.getByRole("button", { name: "新增测试" }));
    expect(await screen.findByRole("textbox", { name: "测试样例行" })).toHaveValue("ERROR charging timeout code=E_TIMEOUT");
    expect(screen.getByRole("textbox", { name: "期望字段 1 值" })).toHaveValue("1");
    fireEvent.change(screen.getByRole("textbox", { name: "期望字段 1 值" }), { target: { value: "2" } });
    await userEvent.click(screen.getByRole("button", { name: "运行测试" }));
    const diff = await screen.findByRole("table", { name: "解析测试差异" });
    expect(diff).toHaveTextContent("fault"); expect(diff).toHaveTextContent("2"); expect(diff).toHaveTextContent("1");
    await userEvent.click(screen.getByRole("tab", { name: /分析用例/ }));
    await userEvent.click(screen.getByRole("tab", { name: /解析测试/ }));
    expect(screen.getByRole("table", { name: "解析测试差异" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "期望字段 1 值" })).toHaveValue("2");
  });

  it("preserves invalid register inputs across sections and blocks saving or publishing an older value", async () => {
    setup({ section: "decoding" });
    fireEvent.click(await screen.findByRole("button", { name: "新增寄存器" }));
    fireEvent.click(screen.getByRole("button", { name: "新增字段" }));
    const bits = screen.getByRole("textbox", { name: "字段 1 位范围" });
    fireEvent.change(bits, { target: { value: "7:" } });
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "概览" }));
    await userEvent.click(screen.getByRole("button", { name: "解码" }));
    expect(screen.getByRole("textbox", { name: "字段 1 位范围" })).toHaveValue("7:");
    fireEvent.change(screen.getByRole("textbox", { name: "字段 1 位范围" }), { target: { value: "7:0" } });
    fireEvent.blur(screen.getByRole("textbox", { name: "字段 1 位范围" }));
    fireEvent.change(screen.getByRole("textbox", { name: "字段 1 枚举" }), { target: { value: '{"0":' } });
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "概览" }));
    await userEvent.click(screen.getByRole("button", { name: "解码" }));
    expect(screen.getByRole("textbox", { name: "字段 1 枚举" })).toHaveValue('{"0":');
    fireEvent.change(screen.getByRole("textbox", { name: "字段 1 枚举" }), { target: { value: '{"0":"normal"}' } });
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "发布" })).toBeEnabled();
  });

  it("saves current edits before running the draft against the stored sample", async () => {
    const { repository, skill } = setup({ procedure: "Original procedure" });
    const description = await screen.findByRole("textbox", { name: "描述" });
    fireEvent.change(description, { target: { value: "Draft for dry run" } });
    const start = screen.getByRole("button", { name: "试运行" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await screen.findByRole("dialog", { name: "试运行" });
    expect(repository.saveSkillDraft).toHaveBeenCalledWith(skill.id, expect.objectContaining({ description: "Draft for dry run" }), null, "current");
    expect(repository.saveSkillDraft.mock.invocationCallOrder[0]).toBeLessThan(repository.startSkillDryRun.mock.invocationCallOrder[0]);
    expect(repository.startSkillDryRun).toHaveBeenCalledWith(skill.id);
    expect(repository.publishSkill).not.toHaveBeenCalled();
  });

  it("runs an existing draft without publishing or saving it again", async () => {
    const { repository } = setup({ draft: true });
    const start = await screen.findByRole("button", { name: "试运行" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await screen.findByRole("dialog", { name: "试运行" });
    expect(repository.saveSkillDraft).not.toHaveBeenCalled();
    expect(repository.startSkillDryRun).toHaveBeenCalledOnce();
  });

  it.each(["success", "conflict"])("locks workspace editing and navigation while the case run saves the draft (%s)", async (outcome) => {
    const { repository, skill } = setup();
    repository.listAnalysisCases.mockResolvedValue({ items: [analysisCase], latestRun: null, current: false });
    let finishSave!: (revision: SkillRevision) => void;
    let rejectSave!: (error: Error) => void;
    repository.saveSkillDraft.mockImplementationOnce(() => new Promise((resolve, reject) => { finishSave = resolve; rejectSave = reject; }));
    fireEvent.change(await screen.findByRole("textbox", { name: "描述" }), { target: { value: "Draft to run" } });
    await userEvent.click(screen.getByRole("button", { name: "测试" }));
    await userEvent.click(await screen.findByRole("tab", { name: /分析用例/ }));
    fireEvent.click(await screen.findByRole("button", { name: "运行全部用例" }));
    await waitFor(() => expect(repository.saveSkillDraft).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "概览" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(requestSettingsLeave()).toBe(false);
    expect(repository.startAnalysisCaseRun).not.toHaveBeenCalled();
    if (outcome === "conflict") {
      await act(async () => { rejectSave(conflictError()); });
      expect(await screen.findByText("草稿已被其他人更新")).toBeVisible();
      expect(repository.startAnalysisCaseRun).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "概览" }));
      expect(await screen.findByRole("textbox", { name: "描述" })).toHaveValue("Draft to run");
      return;
    }
    await act(async () => {
      skill.draft = { ...skill.currentRevision, id: "saved", number: 3, status: "draft", spec: { ...skill.currentRevision.spec, description: "Draft to run" } };
      finishSave(skill.draft);
    });
    await waitFor(() => expect(repository.startAnalysisCaseRun).toHaveBeenCalledOnce());
    expect(await screen.findByRole("progressbar", { name: "分析用例运行进度" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "概览" }));
    expect(await screen.findByRole("textbox", { name: "描述" })).toHaveValue("Draft to run");
  });

  it("hides dry run from users without skill administration permission", async () => {
    const { repository } = setup({ canEdit: false });
    await screen.findByRole("textbox", { name: "描述" });
    expect(screen.queryByRole("button", { name: "试运行" })).not.toBeInTheDocument();
    expect(repository.startSkillDryRun).not.toHaveBeenCalled();
  });

  it("keeps a model override editable and publishable when a superseded initial load finishes late", async () => {
    const skill = structuredClone(mockSkillWorkspace("skill-charging")!);
    let finishFirst!: (history: SkillRevision[]) => void;
    const firstHistory = new Promise<SkillRevision[]>((resolve) => { finishFirst = resolve; });
    const repository = {
      getLogSkill: vi.fn(async () => structuredClone(skill)),
      listSkillRevisions: vi.fn().mockReturnValueOnce(firstHistory).mockResolvedValue([skill.currentRevision]),
      saveSkillDraft: vi.fn<SkillWorkspaceRepository["saveSkillDraft"]>(async (_id, spec) => {
        skill.draft = { ...skill.currentRevision, id: "model-draft", status: "draft", spec };
        return skill.draft;
      }),
      publishSkill: vi.fn<SkillWorkspaceRepository["publishSkill"]>(async () => {
        skill.currentRevision = { ...skill.draft!, status: "published" }; skill.draft = null;
        return structuredClone(skill);
      })
    };
    render(<StrictMode><SkillWorkspace skillId={skill.id} search="?section=integration" repository={repository} apiMode canEdit
      onNavigate={() => undefined} onPublished={() => undefined} /></StrictMode>);
    const override = await screen.findByRole("textbox", { name: "模型覆盖" });
    fireEvent.change(override, { target: { value: "acceptance-domain-model-x" } });
    expect(screen.getByRole("group", { name: "未发布更改" })).toBeVisible();
    await act(async () => { finishFirst([skill.currentRevision]); });
    expect(override).toHaveValue("acceptance-domain-model-x");
    fireEvent.click(within(screen.getByRole("group", { name: "未发布更改" })).getByRole("button", { name: "发布" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "发布技能" })).getByRole("button", { name: "发布" }));
    await waitFor(() => expect(repository.publishSkill).toHaveBeenCalledWith(skill.id, "model-draft"));
    expect(repository.saveSkillDraft).toHaveBeenCalledWith(skill.id, expect.objectContaining({ modelOverride: "acceptance-domain-model-x" }), null, expect.any(String));
  });

  it("keeps signal edits across sections, blocks invalid fields and saves the exact skill representation", async () => {
    const { repository } = setup({ section: "signals" });
    fireEvent.click(await screen.findByRole("button", { name: "添加信号规则" }));
    fireEvent.change(screen.getByRole("textbox", { name: "规则 1名称" }), { target: { value: "Timeout" } });
    fireEvent.change(screen.getByRole("textbox", { name: "规则 1 条件 1消息正则" }), { target: { value: "(?=invalid)" } });
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "试运行" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "规则 1 条件 1消息正则" }), { target: { value: "timeout" } });
    fireEvent.click(screen.getByRole("button", { name: "概览" }));
    fireEvent.click(screen.getByRole("button", { name: "信号" }));
    fireEvent.click(screen.getByRole("button", { name: "展开规则 1" }));
    expect(screen.getByRole("textbox", { name: "规则 1名称" })).toHaveValue("Timeout");
    expect(screen.getByRole("textbox", { name: "规则 1 条件 1消息正则" })).toHaveValue("timeout");
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(repository.saveSkillDraft).toHaveBeenCalledWith("skill-charging", expect.objectContaining({ signalRules: expect.objectContaining({ rules: [expect.objectContaining({ name: "Timeout", anyOf: [{ type: "text", pattern: "timeout" }] })] }) }), null, "current"));
  });
  it("opens the knowledge section and saves selected links through the skill draft", async () => {
    const knowledgeRepository = { list: vi.fn(async () => ({ items: [{ id: "00000000-0000-4000-8000-000000000001", title: "热管理知识", status: "published", headRevisionNumber: 1 }] })),
      get: vi.fn(async () => null) } as unknown as KnowledgeRepository;
    const { repository } = setup({ section: "knowledge", knowledgeRepository });
    await userEvent.click(await screen.findByRole("button", { name: "链接已有条目" }));
    const dialog = screen.getByRole("dialog", { name: "链接已有条目" });
    await userEvent.click(await within(dialog).findByRole("button", { name: "链接 热管理知识" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "完成" }));
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(repository.saveSkillDraft).toHaveBeenCalledWith("skill-charging", expect.objectContaining({ knowledgeEntryIds: ["00000000-0000-4000-8000-000000000001"] }), null, "current"));
  });
  it("prefills an absent procedure without creating an edit, and previews the five-heading outline", async () => {
    setup({ section: "procedure" });
    const editor = await screen.findByRole("textbox", { name: "诊断流程内容" });
    const outline = ["适用场景", "先检查什么", "根因判定", "常见误判", "建议动作"];
    for (const heading of outline) expect((editor as HTMLTextAreaElement).value).toContain(`## ${heading}`);
    expect(editor).toHaveAttribute("maxlength", "20000");
    expect(editor).toHaveAccessibleDescription(`${(editor as HTMLTextAreaElement).value.length} / 20000 字符`);
    expect(screen.queryByRole("group", { name: "未发布更改" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "预览" }));
    const preview = screen.getByRole("tabpanel", { name: "预览" });
    for (const heading of outline) expect(within(preview).getByRole("heading", { name: heading })).toBeVisible();
    expect(preview).toHaveAttribute("tabindex", "0");
    await userEvent.click(screen.getByRole("tab", { name: "编辑" }));
    expect(editor).toBeVisible();
    expect(screen.getByRole("tabpanel", { name: "编辑" })).not.toHaveAttribute("tabindex");
  });
  it("saves procedure edits, preserves them across sections, and publishes a readable field diff", async () => {
    const { repository, onPublished } = setup({ section: "procedure", procedure: "## 先检查什么\n旧流程" });
    const procedure = "## 先检查什么\n核对 **工具证据**。\n<script>alert(1)</script>";
    fireEvent.change(await screen.findByRole("textbox", { name: "诊断流程内容" }), { target: { value: procedure } });
    await userEvent.click(screen.getByRole("tab", { name: "预览" }));
    const preview = screen.getByRole("tabpanel", { name: "预览" });
    expect(within(preview).getByText("工具证据").tagName).toBe("STRONG");
    expect(preview).toHaveTextContent("<script>alert(1)</script>");
    expect(preview.querySelector("script")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "概览" }));
    await userEvent.click(screen.getByRole("button", { name: "诊断流程" }));
    expect(screen.getByRole("textbox", { name: "诊断流程内容" })).toHaveValue(procedure);
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(repository.saveSkillDraft).toHaveBeenCalledWith("skill-charging", expect.objectContaining({ procedure }), null, "current"));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled());
    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    const dialog = screen.getByRole("dialog", { name: "发布技能" });
    expect(within(dialog).getByText("诊断流程 1 项")).toBeVisible();
    expect(within(dialog).queryByLabelText("概览差异")).not.toBeInTheDocument();
    const procedureDiff = within(dialog).getByLabelText("诊断流程差异");
    const row = within(procedureDiff).getByRole("rowheader", { name: "诊断流程" }).closest("tr")!;
    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["## 先检查什么\n旧流程", procedure]);
    await userEvent.click(within(dialog).getByRole("button", { name: "发布" }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith("已发布 v3"));
    expect(repository.publishSkill).toHaveBeenCalledWith("skill-charging", "saved");
    expect(screen.getByRole("textbox", { name: "诊断流程内容" })).toHaveValue(procedure);
  });
  it("discards a procedure edit and preserves an explicitly cleared procedure when saved", async () => {
    const { repository } = setup({ section: "procedure", procedure: "已发布流程" });
    const editor = await screen.findByRole("textbox", { name: "诊断流程内容" });
    fireEvent.change(editor, { target: { value: "本地流程" } });
    await userEvent.click(screen.getByRole("button", { name: "放弃草稿" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "放弃草稿？" })).getByRole("button", { name: "确认" }));
    expect(editor).toHaveValue("已发布流程");
    fireEvent.change(editor, { target: { value: "x".repeat(20000) } });
    expect(screen.getByText("20000 / 20000 字符")).toBeVisible();
    fireEvent.change(editor, { target: { value: "" } });
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(repository.saveSkillDraft).toHaveBeenCalledWith("skill-charging", expect.objectContaining({ procedure: "" }), null, "current"));
    expect(editor).toHaveValue("");
  });
  it.each([{ apiMode: false }, { canEdit: false }])("keeps procedure authoring disabled and its preview available: %j", async (options) => {
    setup({ ...options, section: "procedure" });
    expect(await screen.findByRole("textbox", { name: "诊断流程内容" })).toBeDisabled();
    await userEvent.click(screen.getByRole("tab", { name: "预览" }));
    expect(screen.getByRole("tabpanel", { name: "预览" })).toBeVisible();
  });
  it("previews the mounted shared sample, follows replacements/deletion, and keeps sample scroll across sections", async () => {
    const { repository } = setup({ section: "parsing" });
    const sample = await screen.findByRole("region", { name: "样例内容" });
    await screen.findByText(`使用右侧样例日志：${mockSkillSample.fileName}`);
    sample.scrollTop = 120;
    fireEvent.click(screen.getByRole("button", { name: "运行预览" }));
    await waitFor(() => expect(repository.parsePreview).toHaveBeenCalledWith("skill-charging", expect.objectContaining({ sampleText: mockSkillSample.content, fileName: mockSkillSample.fileName })));
    expect(repository.getSkillSample).toHaveBeenCalledTimes(1);
    expect(repository.getSkillSampleText).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "版本" }));
    await userEvent.click(screen.getByRole("button", { name: "样例与解析" }));
    expect(screen.getByRole("region", { name: "样例内容" })).toBe(sample);
    expect(sample.scrollTop).toBe(120);
    expect(repository.getSkillSample).toHaveBeenCalledTimes(1);
    repository.getSkillSample.mockResolvedValueOnce({ ...mockSkillSample, fileName: "replacement.log", content: "replacement sample" });
    fireEvent.change(screen.getByLabelText("选择样例日志"), { target: { files: [new File(["replacement sample"], "replacement.log")] } });
    await screen.findByText("使用右侧样例日志：replacement.log");
    fireEvent.click(screen.getByRole("button", { name: "运行预览" }));
    await waitFor(() => expect(repository.parsePreview).toHaveBeenLastCalledWith("skill-charging", expect.objectContaining({ sampleText: "replacement sample", fileName: "replacement.log" })));
    fireEvent.click(screen.getByRole("button", { name: "删除样例" }));
    const dialog = screen.getByRole("dialog", { name: "删除样例日志？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "删除样例" }));
    const fallback = await screen.findByRole("textbox", { name: "样例文本" });
    fireEvent.change(fallback, { target: { value: "pasted fallback" } });
    fireEvent.click(screen.getByRole("button", { name: "运行预览" }));
    await waitFor(() => expect(repository.parsePreview).toHaveBeenLastCalledWith("skill-charging", expect.objectContaining({ sampleText: "pasted fallback", fileName: "sample.log" })));
  });
  it("hides the mounted sample on full-width sections and preserves its scroll when returning", async () => {
    const { repository } = setup();
    const sample = await screen.findByRole("region", { name: "样例内容" });
    expect(sample).toHaveAttribute("data-sample-scroll");
    sample.scrollTop = 120;
    await userEvent.click(screen.getByRole("button", { name: "版本" }));
    expect(screen.queryByRole("region", { name: "样例日志" })).not.toBeInTheDocument();
    expect(sample).not.toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "源码" }));
    expect(screen.queryByRole("region", { name: "样例日志" })).not.toBeInTheDocument();
    expect(sample).not.toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "诊断流程" }));
    expect(screen.queryByRole("region", { name: "样例日志" })).not.toBeInTheDocument();
    expect(sample).not.toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "样例与解析" }));
    expect(screen.getByRole("region", { name: "样例内容" })).toBe(sample);
    expect(sample).toBeVisible();
    expect(sample.scrollTop).toBe(120);
    await userEvent.click(screen.getByRole("button", { name: "概览" }));
    expect(screen.getByRole("region", { name: "样例内容" })).toBe(sample);
    expect(sample).toBeVisible();
    expect(sample.scrollTop).toBe(120);
    expect(repository.getSkillSample).toHaveBeenCalledTimes(1);
  });
  it("edits parsing in the shared draft, saves and publishes it, and blocks invalid YAML", async () => {
    const { repository } = setup({ section: "parsing" });
    await userEvent.click(await screen.findByRole("tab", { name: "代码视图" }));
    const editor = await screen.findByRole("textbox", { name: "代码视图 · YAML" });
    fireEvent.change(editor, { target: { value: "schemaVersion: parsing/v1\nextractors: [" } });
    expect(screen.getByRole("group", { name: "未发布更改" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    fireEvent.change(editor, { target: { value: "schemaVersion: parsing/v1\nextractors:\n  - id: current\n    pattern: '(?P<value>.+)'\n    fields:\n      value: {type: string}\n" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(repository.saveSkillDraft).toHaveBeenCalledWith("skill-charging", expect.objectContaining({ parsing: expect.objectContaining({ schemaVersion: "parsing/v1", extractors: [expect.objectContaining({ id: "current" })] }) }), null, "current"));
    await waitFor(() => expect(screen.getByRole("button", { name: "发布" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    const dialog = screen.getByRole("dialog", { name: "发布技能" });
    expect(within(dialog).getByLabelText("解析规则差异")).toHaveTextContent("current · 新增");
    fireEvent.click(within(dialog).getByRole("button", { name: "发布" }));
    await waitFor(() => expect(repository.publishSkill).toHaveBeenCalledWith("skill-charging", "saved"));
  });
  it("blocks saving and section changes for invalid format drafts and explicitly discards the local draft", async () => {
    const { repository } = setup({ section: "parsing" });
    fireEvent.change(await screen.findByRole("textbox", { name: "时间戳模式" }), { target: { value: "(?=bad)" } });
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "试运行" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "概览" }));
    expect(screen.getByRole("textbox", { name: "时间戳模式" })).toHaveValue("(?=bad)");
    expect(screen.getByText("请先修正基础格式，再切换分区。")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "放弃草稿" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "放弃草稿？" })).getByRole("button", { name: "确认" }));
    expect(screen.getByRole("textbox", { name: "时间戳模式" })).toHaveValue("");
    expect(screen.queryByRole("group", { name: "未发布更改" })).not.toBeInTheDocument();
    expect(repository.saveSkillDraft).not.toHaveBeenCalled();
  });
  it("opens the source section and includes its default draft in publication review", async () => {
    const { repository } = setup();
    await screen.findByRole("textbox", { name: "描述" });
    await userEvent.click(screen.getByRole("button", { name: "源码" }));
    await userEvent.click(await screen.findByRole("button", { name: "设为默认" }));
    expect(repository.setDefaultSourceSnapshot).toHaveBeenCalledWith("skill-charging", "source-default");
    expect(await screen.findByText("草稿默认")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    const review = within(screen.getByRole("dialog", { name: "发布技能" }));
    expect(review.getByLabelText("源码差异")).toHaveTextContent("默认源码快照");
    expect(review.getByLabelText("变更摘要")).toHaveTextContent("源码 1 项");
    await userEvent.click(review.getByRole("button", { name: "发布" }));
    await waitFor(() => expect(repository.publishSkill).toHaveBeenCalledWith("skill-charging", "source-draft"));
  });
  it("shows compact overview facts without leaking the internal skill id", async () => {
    setup();
    await screen.findByRole("textbox", { name: "描述" });
    expect(screen.queryByText("技能标识")).not.toBeInTheDocument();
    expect(screen.queryByText("skill-charging")).not.toBeInTheDocument();
    const configured = screen.getByRole("region", { name: "已配置内容" });
    expect(configured.querySelector("dl")).toHaveClass("skill-facts");
    expect(within(configured).getByText("基础格式").tagName).toBe("DT");
    expect(within(configured).getByText("平台通用信号").tagName).toBe("DD");
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
    await userEvent.click(screen.getByRole("button", { name: "诊断流程" }));
    fireEvent.change(screen.getByRole("textbox", { name: "诊断流程内容" }), { target: { value: "新流程" } });
    const bar = screen.getByRole("group", { name: "未发布更改" });
    await userEvent.click(within(bar).getByRole("button", { name: "发布" }));
    const dialog = screen.getByRole("dialog", { name: "发布技能" });
    expect(within(dialog).getByLabelText("概览差异")).toHaveTextContent("新描述");
    expect(within(dialog).getByText("概览 1 项 · 诊断流程 1 项")).toBeVisible();
    expect(within(dialog).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["发布前测试", "概览", "诊断流程"]);
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
  it("enables every section and switches freely without dropping local edits", async () => {
    const { onNavigate } = setup();
    fireEvent.change(await screen.findByRole("textbox", { name: "描述" }), { target: { value: "未保存" } });
    expect(screen.getByRole("button", { name: "解码" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "信号" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "测试" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /集成/ })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "测试" }));
    expect(screen.getByRole("table", { name: "解析测试列表" })).toBeInTheDocument();
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
    expect(screen.getByText(/仅供查看；/)).toBeInTheDocument();
    expect(repository.saveSkillDraft).not.toHaveBeenCalled();
  });
  it("renders the standard missing state for an inaccessible id", async () => {
    render(<SkillWorkspace skillId="missing" search="" apiMode={false} canEdit={false} onNavigate={vi.fn()} onPublished={vi.fn()} />);
    expect(await screen.findByText("未找到分析技能")).toBeVisible();
    expect(screen.getByRole("button", { name: "返回分析技能" })).toBeEnabled();
  });
});
