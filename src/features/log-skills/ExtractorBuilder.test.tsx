import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parse, stringify } from "yaml";
import { generateExtractorPattern } from "../../../server/modules/logs/parsing/engine";
import { ParsingSection } from "./ParsingSection";
import { SkillSamplePane } from "./SkillSamplePane";
import { mockSkillSample } from "@/infrastructure/mock/logSkills";
import type { SkillSpec, SkillWorkspaceRepository } from "./types";

afterEach(cleanup);
const sample = { ...mockSkillSample, content: "charger vbus=9012 ibus=1450 temp=71\ncharger vbus=5000 ibus=700 temp=55\nother state=idle", lineCount: 3 };
const initial: NonNullable<SkillSpec["parsing"]> = { schemaVersion: "parsing/v1", extractors: [] };
function setup(spec = initial) {
  const save = vi.fn();
  const repository: Partial<SkillWorkspaceRepository> = { generateExtractorPattern: vi.fn(async (_id, input) => generateExtractorPattern(input)) };
  function Harness() {
    const [yaml, setYaml] = useState(stringify(spec));
    const [line, setLine] = useState<number | null>(null);
    return <><ParsingSection skillId={sample.skillId} yaml={yaml} onChange={(next) => { save(parse(next)); setYaml(next); }} disabled={false} repository={repository} sample={sample} selectedLine={line} onLineSelect={setLine} />
      <SkillSamplePane skillId={sample.skillId} apiMode canEdit repository={{ getSkillSample: async () => sample }} selectedLine={line} onLineSelect={setLine} /></>;
  }
  render(<Harness />); return { save, repository };
}

describe("extractor authoring", () => {
  it("selects a docked line, names and types key=value segments, previews coverage and saves into the spec", async () => {
    const { save } = setup();
    await userEvent.click(await screen.findByRole("button", { name: /选择样例第 1 行/ }));
    fireEvent.click(screen.getByRole("button", { name: "从此行创建抽取规则" }));
    const dialog = screen.getByRole("dialog");
    for (const value of ["vbus=9012", "ibus=1450", "temp=71"]) fireEvent.click(within(dialog).getByRole("button", { name: `片段 ${value}` }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "片段 9012 的字段名" }), { target: { value: "voltage" } });
    await userEvent.click(within(dialog).getByRole("combobox", { name: "字段 temp 的类型" }));
    await userEvent.click(screen.getByRole("option", { name: "int" }));
    expect(await within(dialog).findByText("命中 2 / 3 行 · 覆盖率 66.7%" )).toBeVisible();
    expect(within(dialog).getByLabelText("生成模式")).toHaveTextContent("(?P<voltage>\\d+)");
    expect(within(dialog).getByRole("list", { name: "首批匹配行" })).not.toHaveTextContent("other state");
    fireEvent.click(within(dialog).getByRole("button", { name: "保存抽取规则" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const saved = save.mock.lastCall![0];
    expect(saved.extractors[0]).toMatchObject({ id: "extractor1", fields: { voltage: { type: "uint" }, ibus: { type: "uint" }, temp: { type: "int" } } });
    await userEvent.click(screen.getByRole("tab", { name: "代码视图" }));
    expect(parse((screen.getByRole("textbox", { name: "代码视图 · YAML" }) as HTMLTextAreaElement).value)).toEqual(saved);
    await userEvent.click(screen.getByRole("tab", { name: "表单" }));
    expect(screen.getByRole("table", { name: "抽取规则列表" })).toHaveTextContent("voltage、ibus、temp");
  });
  it("selects a range with Shift and rejects invalid RE2 under advanced without allowing stale saves", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "从此行创建抽取规则" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "片段 vbus=9012" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "片段 temp=71" }), { shiftKey: true });
    expect(within(dialog).getByRole("textbox", { name: "片段 9012 ibus=1450 temp=71 的字段名" })).toBeVisible();
    expect(await within(dialog).findByText("命中 2 / 3 行 · 覆盖率 66.7%" )).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "高级" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "RE2 模式" }), { target: { value: "(?=bad)" } });
    expect(within(dialog).getByRole("button", { name: "保存抽取规则" })).toBeDisabled();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/invalid|unsupported|syntax/i);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "RE2 模式" }), { target: { value: "^other state=(?P<state>\\S+)$" } });
    expect(await within(dialog).findByText("命中 1 / 3 行 · 覆盖率 33.3%" )).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "保存抽取规则" })).toBeEnabled();
  });
  it("edits existing patterns while preserving file filters, multiline rules and richer field definitions", async () => {
    const spec = { ...initial, extractors: [{ id: "status", files: ["*.log"], pattern: "^other state=(?P<state>\\S+)$", fields: { state: { type: "enum" as const, values: { idle: "idle" } } }, multiline: { start: "^other", maxLines: 2 } }] };
    const { save } = setup(spec);
    fireEvent.click(screen.getByRole("button", { name: "编辑 status" }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText("命中 1 / 3 行 · 覆盖率 33.3%" )).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "保存抽取规则" }));
    expect(save.mock.lastCall![0]).toEqual(spec);
  });
  it("labels matching lines and uses distinct legend colors for each extractor, including overlapping matches", async () => {
    const extractors = ["voltage", "current"].map((id) => ({ id, pattern: "charger", fields: {} }));
    const events = extractors.map(({ id }) => ({ v: 1 as const, source: "declarative" as const, file: sample.fileName, line: 1, extractor: id, fields: {} }));
    render(<SkillSamplePane skillId={sample.skillId} apiMode canEdit repository={{ getSkillSample: async () => sample }} extractors={extractors}
      highlightPreview={{ valid: true, truncated: false, issues: [], events, counts: { total: 2, byExtractor: { voltage: 1, current: 1 }, errors: {} }, unmatchedLineCount: 2 }} />);
    const legend = await screen.findByRole("list", { name: "抽取器高亮图例" });
    const items = within(legend).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("voltage · 1 次命中");
    expect(items[1]).toHaveTextContent("current · 1 次命中");
    expect(items[0].getAttribute("style")).not.toBe(items[1].getAttribute("style"));
    const line = screen.getByText(sample.content.split("\n")[0]).closest(".skill-sample-line")!;
    expect(line).toHaveAttribute("data-extractor-match", "true");
    expect(line).toHaveTextContent("voltagecurrent");
  });
});
