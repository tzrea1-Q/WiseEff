import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParseTestsSection } from "./ParseTestsSection";
import { SkillWorkspace } from "./SkillWorkspace";
import { SkillSpecDiff } from "./SkillSpecDiff";
import { mockSkillSample, mockSkillWorkspace } from "@/infrastructure/mock/logSkills";
import type { ParseTestRun, SkillSpec, SkillWorkspaceRepository } from "./types";

afterEach(cleanup);
const test = { id: "fault", name: "Charge fault", lines: ["REG0C=0x20"], expect: { fields: { "val.fields.CHRG_FAULT.meaning": "normal" }, signals: ["fault"], exactSignals: true } };
const failed: ParseTestRun = { total: 1, passed: 0, failed: 1, truncated: false, results: [{ id: "fault", name: "Charge fault", passed: false,
  diffs: [{ path: "val.fields.CHRG_FAULT.meaning", expected: "normal", actual: "input fault" }], missingSignals: ["fault"], unexpectedSignals: ["warning"], events: [], signals: ["warning"] }] };

describe("parse test workspace", () => {
  it("adds the selected sample line with normalized decode expectations, and edits/deletes paths without raw JSON", async () => {
    const repository = { parsePreview: vi.fn<NonNullable<SkillWorkspaceRepository["parsePreview"]>>(async () => ({ valid: true, truncated: false, issues: [],
      counts: { total: 1, byExtractor: { reg: 1 }, errors: {} }, unmatchedLineCount: 0,
      events: [{ v: 1, source: "declarative", file: "charging.log", line: 1, extractor: "reg", fields: { val: { raw: "0x20", value: 32, fields: { CHRG_FAULT: { raw: "10", value: 2, meaning: "input fault" } } } } }] })) };
    let current: SkillSpec;
    function Harness() {
      const [spec, setSpec] = useState<SkillSpec>({ schemaVersion: "skill/v1", parsing: { schemaVersion: "parsing/v1", extractors: [] } });
      current = spec;
      return <ParseTestsSection skillId="skill-charging" spec={spec} setSpec={setSpec} disabled={false} repository={repository}
        sample={mockSkillSample} selectedLine={2} result={null} onRun={vi.fn()} onBusyChange={vi.fn()} onValidityChange={vi.fn()} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "新增测试" }));
    await screen.findByRole("textbox", { name: "测试名称" });
    expect(repository.parsePreview).toHaveBeenCalledWith("skill-charging", expect.objectContaining({ sampleText: "ERROR charging timeout code=E_TIMEOUT" }));
    expect(current!.parseTests?.[0]).toMatchObject({ lines: ["ERROR charging timeout code=E_TIMEOUT"], fileName: "charging.log",
      expect: { fields: { "val.value": 32, "val.fields.CHRG_FAULT.value": 2, "val.fields.CHRG_FAULT.meaning": "input fault" } } });
    expect(Object.keys(current!.parseTests![0].expect.fields!)).not.toContain("val.raw");
    fireEvent.change(screen.getByRole("textbox", { name: "期望字段 3 值" }), { target: { value: '"normal"' } });
    expect(current!.parseTests![0].expect.fields!["val.fields.CHRG_FAULT.meaning"]).toBe("normal");
    fireEvent.click(screen.getByRole("button", { name: "删除期望字段 2" }));
    expect(current!.parseTests![0].expect.fields!["val.fields.CHRG_FAULT.value"]).toBeUndefined();
    fireEvent.change(screen.getByRole("textbox", { name: "测试文件名" }), { target: { value: "" } });
    expect(current!.parseTests![0]).not.toHaveProperty("fileName");
  });

  it("renders field diffs and missing/unexpected signal sets inline", () => {
    const result = structuredClone(failed);
    result.results[0].diffs.push({ path: "absent.value", expected: 1, actual: null, missing: true });
    render(<ParseTestsSection skillId="skill" spec={{ schemaVersion: "skill/v1", parseTests: [test] }} setSpec={vi.fn()} disabled={false}
      sample={null} selectedLine={null} result={result} onRun={vi.fn()} onBusyChange={vi.fn()} onValidityChange={vi.fn()} />);
    const diff = screen.getByRole("table", { name: "解析测试差异" });
    expect(within(diff).getByText("val.fields.CHRG_FAULT.meaning")).toBeVisible();
    expect(within(diff).getByText('"normal"')).toBeVisible();
    expect(within(diff).getByText('"input fault"')).toBeVisible();
    expect(within(diff).getByText("字段缺失")).toBeVisible();
    expect(screen.getByText("缺少信号：fault")).toBeVisible();
    expect(screen.getByText("多余信号：warning")).toBeVisible();
  });

  it("keeps publishing available when the prepublication test request fails", async () => {
    const skill = mockSkillWorkspace("skill-charging")!;
    skill.draft = { ...skill.currentRevision, id: "draft", status: "draft", spec: { ...skill.currentRevision.spec, parseTests: [test] } };
    const repository = { getLogSkill: vi.fn(async () => skill), listSkillRevisions: vi.fn(async () => [skill.draft!, skill.currentRevision]),
      getSkillSample: vi.fn(async () => null), runSkillParseTests: vi.fn(async () => { throw new Error("offline"); }),
      publishSkill: vi.fn(async () => ({ ...skill, currentRevision: { ...skill.draft!, status: "published" as const }, draft: null })) };
    render(<SkillWorkspace skillId={skill.id} search="" repository={repository} apiMode canEdit onNavigate={vi.fn()} onPublished={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "发布" }));
    const dialog = await screen.findByRole("dialog", { name: "发布技能" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "发布" })).toBeEnabled());
    expect(within(dialog).getByText("解析测试暂时无法运行，请重试。仍可发布技能。")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "发布" }));
    await waitFor(() => expect(repository.publishSkill).toHaveBeenCalled());
  });

  it("rejects duplicate field paths without overwriting expectations or saving stale inputs", async () => {
    const skill = mockSkillWorkspace("skill-charging")!;
    skill.draft = { ...skill.currentRevision, id: "draft", status: "draft", spec: { ...skill.currentRevision.spec,
      parseTests: [{ ...test, expect: { fields: { first: 1, second: 2 } } }] } };
    const repository = { getLogSkill: vi.fn(async () => skill), listSkillRevisions: vi.fn(async () => [skill.draft!, skill.currentRevision]), getSkillSample: vi.fn(async () => null) };
    render(<SkillWorkspace skillId={skill.id} search="?section=tests" repository={repository} apiMode canEdit onNavigate={vi.fn()} onPublished={vi.fn()} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "期望字段 2 路径" }), { target: { value: "first" } });
    expect(screen.getByRole("alert")).toHaveTextContent("字段路径重复");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "期望字段 2 路径" }), { target: { value: "second" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发布" })).toBeEnabled();
  });

  it("keeps duplicate paths invalid through code toggles and clears local guards when selecting or deleting a test", async () => {
    const skill = mockSkillWorkspace("skill-charging")!;
    skill.draft = { ...skill.currentRevision, id: "draft", status: "draft", spec: { ...skill.currentRevision.spec,
      parseTests: [{ ...test, expect: { fields: { first: 1, second: 2 } } }, { ...test, id: "other", name: "Other case" }] } };
    const repository = { getLogSkill: vi.fn(async () => skill), listSkillRevisions: vi.fn(async () => [skill.draft!, skill.currentRevision]), getSkillSample: vi.fn(async () => null) };
    render(<SkillWorkspace skillId={skill.id} search="?section=tests" repository={repository} apiMode canEdit onNavigate={vi.fn()} onPublished={vi.fn()} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "期望字段 2 路径" }), { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: "代码视图 · JSON" }));
    expect(screen.getByRole("textbox", { name: "期望代码" })).toBeVisible();
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("字段路径重复");
    fireEvent.click(screen.getByRole("button", { name: "代码视图 · JSON" }));
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Other case" }));
    expect(screen.getByRole("button", { name: "发布" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Charge fault" }));
    fireEvent.change(screen.getByRole("textbox", { name: "期望字段 2 路径" }), { target: { value: "first" } });
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "删除测试" }));
    expect(screen.getByRole("textbox", { name: "测试名称" })).toHaveValue("Other case");
    expect(screen.getByRole("button", { name: "发布" })).toBeEnabled();
  });

  it("clears an unapplied code guard when switching tests", async () => {
    const skill = mockSkillWorkspace("skill-charging")!;
    skill.draft = { ...skill.currentRevision, id: "draft", status: "draft", spec: { ...skill.currentRevision.spec,
      parseTests: [test, { ...test, id: "other", name: "Other case" }] } };
    const repository = { getLogSkill: vi.fn(async () => skill), listSkillRevisions: vi.fn(async () => [skill.draft!, skill.currentRevision]), getSkillSample: vi.fn(async () => null) };
    render(<SkillWorkspace skillId={skill.id} search="?section=tests" repository={repository} apiMode canEdit onNavigate={vi.fn()} onPublished={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "代码视图 · JSON" }));
    fireEvent.change(screen.getByRole("textbox", { name: "期望代码" }), { target: { value: "{" } });
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Other case" }));
    expect(screen.getByRole("button", { name: "发布" })).toBeEnabled();
  });

  it("shows failed counts before publication, links to tests and allows publishing", async () => {
    const skill = mockSkillWorkspace("skill-charging")!;
    skill.draft = { ...skill.currentRevision, id: "draft", status: "draft", spec: { ...skill.currentRevision.spec, parseTests: [test] } };
    const repository = { getLogSkill: vi.fn(async () => skill), listSkillRevisions: vi.fn(async () => [skill.draft!, skill.currentRevision]),
      getSkillSample: vi.fn(async () => null), runSkillParseTests: vi.fn(async () => failed),
      publishSkill: vi.fn(async () => ({ ...skill, currentRevision: { ...skill.draft!, status: "published" as const }, draft: null, parseTestRun: failed })) };
    const onNavigate = vi.fn();
    render(<SkillWorkspace skillId={skill.id} search="" repository={repository} apiMode canEdit onNavigate={onNavigate} onPublished={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "发布" }));
    await screen.findByText("解析测试 0/1 通过");
    const dialog = screen.getByRole("dialog", { name: "发布技能" });
    expect(within(dialog).getByText("测试失败不会阻止发布。")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "查看失败测试" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.stringContaining("section=tests"));
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "发布技能" })).getByRole("button", { name: "发布" })).toBeEnabled());
    fireEvent.click(within(screen.getByRole("dialog", { name: "发布技能" })).getByRole("button", { name: "发布" }));
    await waitFor(() => expect(repository.publishSkill).toHaveBeenCalledWith(skill.id, "draft"));
  });

  it("invalidates run status after an expectation edit and uses the latest result from draft save", async () => {
    const skill = mockSkillWorkspace("skill-charging")!;
    skill.draft = { ...skill.currentRevision, id: "draft", status: "draft", spec: { ...skill.currentRevision.spec, parseTests: [test] } };
    const repository = { getLogSkill: vi.fn(async () => skill), listSkillRevisions: vi.fn(async () => [skill.draft!, skill.currentRevision]),
      getSkillSample: vi.fn(async () => null), runSkillParseTests: vi.fn(async () => failed),
      saveSkillDraft: vi.fn<SkillWorkspaceRepository["saveSkillDraft"]>(async (_id, spec) => ({ ...skill.draft!, spec, parseTestRun: failed })) };
    render(<SkillWorkspace skillId={skill.id} search="?section=tests" repository={repository} apiMode canEdit onNavigate={vi.fn()} onPublished={vi.fn()} />);
    await screen.findByRole("textbox", { name: "测试名称" });
    fireEvent.click(within(screen.getByRole("group", { name: "未发布更改" })).getByRole("button", { name: "运行测试" }));
    await screen.findByRole("table", { name: "解析测试差异" });
    fireEvent.change(screen.getByRole("textbox", { name: "期望字段 1 值" }), { target: { value: '"fixed"' } });
    expect(screen.queryByRole("table", { name: "解析测试差异" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "解析测试列表" })).getByText("未运行")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByRole("table", { name: "解析测试差异" });
    expect(repository.saveSkillDraft).toHaveBeenCalled();
  });

  it("includes test-only changes in publication review", () => {
    render(<SkillSpecDiff before={{ schemaVersion: "skill/v1" }} after={{ schemaVersion: "skill/v1", parseTests: [test] }} />);
    expect(screen.getByText("解析测试已更改")).toBeVisible();
    expect(screen.getByRole("region", { name: "解析测试差异" })).toBeVisible();
  });
});
