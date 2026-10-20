import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { logSkillSpecSchema } from "@wiseeff/dto-schemas";
import { SignalsSection } from "./SignalsSection";
import { SkillSamplePane } from "./SkillSamplePane";
import { mockSkillSample } from "@/infrastructure/mock/logSkills";
import type { SignalPreview, SkillSpec, SkillWorkspaceRepository } from "./types";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const result: SignalPreview = { valid: true, issues: [], hits: [], truncated: false };
const initial: SkillSpec = { schemaVersion: "skill/v1", parsing: { schemaVersion: "parsing/v1", extractors: [{ id: "status", pattern: "temp=(?P<temp>.+)", fields: { temp: { type: "float" } } }] },
  signalRules: { rules: [{ id: "legacy", anyOf: [{ type: "text", pattern: "timeout", flags: "i" }, { type: "severityToken", severity: "error", token: "code" }],
    stageId: "rootcause", inference: "Timeout", suggestedAction: "Check availability.", analysis: { conclusion: { value: "Timed out", priority: 2, requiresErrorEvidence: true }, suggestedActions: [] } }],
  noHit: { conclusion: "None", impact: "None", severity: "Info", confidence: 0.4, suggestedActions: [] },
  hitDefaults: { conclusion: "Found", impact: "Review", severity: "Warning", confidence: 0.7, suggestedActions: ["Review"] } } };
function setup(spec = initial, repository: Partial<SkillWorkspaceRepository> = { signalPreview: vi.fn(async () => result) }) {
  const onChange = vi.fn();
  const onHit = vi.fn();
  function Harness() {
    const [value, setValue] = useState(structuredClone(spec));
    return <SignalsSection skillId="s" spec={value} onChange={(next) => { setValue(next); onChange(next); }} disabled={false} repository={repository} sample={mockSkillSample} onHit={onHit} />;
  }
  render(<Harness />); return { onChange, onHit, repository };
}
async function choose(label: string, option: string) {
  await userEvent.click(screen.getByRole("combobox", { name: (name) => name === label || name.startsWith(`${label}：`) }));
  await userEvent.click(await screen.findByRole("option", { name: option }));
}
describe("signal authoring", () => {
  it("compacts text alternatives under one label and keeps the complete summary as its title", () => {
    const spec = structuredClone(initial);
    spec.signalRules!.rules[0] = { ...spec.signalRules!.rules[0], name: "热降额", severity: "Critical", anyOf: [
      { type: "text", pattern: "thermal" }, { type: "text", pattern: "battery_temp" },
      { type: "text", pattern: "derating" }, { type: "text", pattern: "overheat" }
    ] };
    setup(spec);
    expect(screen.getByText("当 消息匹配 thermal / battery_temp 等 4 个")).toBeVisible();
    const summary = screen.getByTitle("当 消息匹配 thermal / battery_temp / derating / overheat 时，产生 热降额 · 严重 · 命中待预览");
    expect(within(summary).getByText("热降额")).toBeVisible();
    expect(within(summary).getByText("· 严重 · 命中待预览")).toBeVisible();
  });
  it("collapses existing rules and shows translated legacy conditions with a numbered fallback name", async () => {
    const { onChange } = setup();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByTitle(/当 消息匹配 timeout \/ 日志级别为 错误 且包含 code 时，产生 规则 1/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "展开规则 1" }));
    expect(screen.getByText("日志级别为 错误 且包含 code")).toBeVisible();
    expect(screen.getByText("仅可在代码视图编辑")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "规则 1名称" })).toHaveValue("规则 1");
    expect(screen.queryByText("legacy")).not.toBeInTheDocument();
    expect(screen.queryByText(/兼容条件：/)).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("keeps text being typed into a scalar value without inserting JSON quotes", async () => {
    const spec = structuredClone(initial);
    spec.parsing!.extractors[0].fields.temp = { type: "string" };
    spec.signalRules!.rules[0].anyOf = [{ type: "field", field: "status.temp", operator: "equals", value: "" }];
    const { onChange } = setup(spec);
    await userEvent.click(screen.getByRole("button", { name: "展开规则 1" }));
    const input = screen.getByRole("textbox", { name: "规则 1 条件 1值" });
    await userEvent.clear(input);
    await userEvent.type(input, "hot");
    expect(input).toHaveValue("hot");
    expect(onChange.mock.lastCall![0].signalRules.rules[0].anyOf[0].value).toBe("hot");
  });
  it("keeps distinct legacy inference when renaming and renders numeric comparisons as a sentence", async () => {
    const spec = structuredClone(initial);
    spec.signalRules!.rules[0].anyOf = [{ type: "numericComparison", leftTokens: ["current", "current_ma"], operator: "lt", rightTokens: ["requested_ma"] }];
    const { onChange } = setup(spec);
    await userEvent.click(screen.getByRole("button", { name: "展开规则 1" }));
    expect(screen.getByText("current / current_ma 小于 requested_ma")).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "规则 1名称" }), { target: { value: "电流不足" } });
    expect(onChange.mock.lastCall![0].signalRules.rules[0]).toEqual({ ...spec.signalRules!.rules[0], name: "电流不足" });
  });
  it("preserves readable set input while typing", async () => {
    const spec = structuredClone(initial);
    spec.signalRules!.rules[0].anyOf = [{ type: "field", field: "status.temp", operator: "in", values: [] }];
    const { onChange } = setup(spec);
    const input = screen.getByRole("textbox", { name: "规则 1 条件 1集合" });
    await userEvent.type(input, "10,20");
    expect(input).toHaveValue("10,20");
    expect(onChange.mock.lastCall![0].signalRules.rules[0].anyOf[0].values).toEqual([10, 20]);
  });
  it("round-trips existing rules without altering hidden metadata and supports editing, reordering and deletion", async () => {
    const { onChange } = setup();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "展开规则 1" }));
    expect(screen.getByRole("combobox", { name: "规则 1级别" })).toHaveAttribute("data-value", "Warning");
    await userEvent.click(screen.getByRole("button", { name: "添加信号规则" }));
    let next = onChange.mock.lastCall![0] as SkillSpec;
    expect(next.signalRules!.rules[0]).toEqual(initial.signalRules!.rules[0]);
    expect(logSkillSpecSchema.parse(JSON.parse(JSON.stringify(next)))).toEqual(next);
    fireEvent.change(screen.getByRole("textbox", { name: "规则 2名称" }), { target: { value: "High temperature" } });
    await choose("规则 2级别", "严重");
    await userEvent.click(screen.getByRole("button", { name: "上移规则 2" }));
    next = onChange.mock.lastCall![0];
    expect(next.signalRules!.rules[0]).toMatchObject({ name: "High temperature", severity: "Critical" });
    expect(next.signalRules!.rules[0].inference).toBe("High temperature");
    expect(next.signalRules!.rules[1]).toEqual(initial.signalRules!.rules[0]);
    await userEvent.click(screen.getByRole("button", { name: "删除规则 1" }));
    expect(onChange.mock.lastCall![0]).not.toEqual(initial);
    expect(screen.getByRole("button", { name: "删除规则" })).toHaveClass("danger");
    await userEvent.click(screen.getByRole("button", { name: "删除规则" }));
    expect(onChange.mock.lastCall![0]).toEqual(initial);
  });
  it("builds field equality, range, set and per-file window conditions in the skill representation", async () => {
    const { onChange } = setup({ ...initial, signalRules: { ...initial.signalRules!, rules: [{ ...initial.signalRules!.rules[0], anyOf: [{ type: "text", pattern: "error" }] }] } });
    await userEvent.click(screen.getByRole("button", { name: "展开规则 1" }));
    await choose("规则 1 条件 1类型", "抽取字段");
    fireEvent.change(screen.getByRole("textbox", { name: "规则 1 条件 1值" }), { target: { value: "7" } });
    expect(onChange.mock.lastCall![0].signalRules.rules[0].anyOf[0]).toEqual({ type: "field", field: "status.temp", operator: "equals", value: 7 });
    await choose("规则 1 条件 1比较方式", "在范围内");
    fireEvent.change(screen.getByRole("spinbutton", { name: "规则 1 条件 1最小值" }), { target: { value: "10" } });
    expect(onChange.mock.lastCall![0].signalRules.rules[0].anyOf[0]).toEqual({ type: "field", field: "status.temp", operator: "range", min: 10, max: 100 });
    await choose("规则 1 条件 1比较方式", "属于集合");
    fireEvent.change(screen.getByRole("textbox", { name: "规则 1 条件 1集合" }), { target: { value: "10, 20" } });
    expect(onChange.mock.lastCall![0].signalRules.rules[0].anyOf[0]).toEqual({ type: "field", field: "status.temp", operator: "in", values: [10, 20] });
    await choose("规则 1 条件 1类型", "时间窗内计数");
    await choose("规则 1 条件 1子条件类型", "抽取字段");
    fireEvent.change(screen.getByRole("textbox", { name: "规则 1 条件 1子条件值" }), { target: { value: "7" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "规则 1 条件 1时间窗（秒）" }), { target: { value: "30" } });
    const next = onChange.mock.lastCall![0];
    expect(next.signalRules.rules[0].anyOf[0]).toEqual({ type: "window", condition: { type: "field", field: "status.temp", operator: "equals", value: 7 }, count: 2, seconds: 30 });
    expect(logSkillSpecSchema.parse(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
  it("selects decoded meanings and numeric leaves with units, previews hits and highlights their sample line", async () => {
    const spec = structuredClone(initial);
    spec.parsing = { schemaVersion: "parsing/v1",
      registers: { REG0C: { width: 8, fields: [{ name: "CHRG_FAULT", bits: [5, 4], enum: { "0": "normal", "2": "thermal_shutdown" } }, { name: "VOLTAGE", bits: [3, 0], unit: "mV" }] } },
      registerMaps: { charger: { selectBy: "addr", cases: { "0x0C": "REG0C" } } },
      extractors: [{ id: "dump", pattern: "addr=(?<addr>\\S+) val=(?<val>\\S+)", fields: { addr: { type: "uint" }, val: { type: "uint", decode: { registerMap: "charger" } } } }] };
    spec.signalRules!.rules[0].anyOf = [{ type: "text", pattern: "timeout" }];
    const sample = { ...mockSkillSample, content: "unmatched\naddr=0x0C val=0x20", lineCount: 2 };
    const onChange = vi.fn();
    const signalPreview = vi.fn<NonNullable<SkillWorkspaceRepository["signalPreview"]>>(async (_id, input) => ({ ...result,
      hits: input.signalRules.rules[0].anyOf.some((condition) => condition.type === "field" && condition.field === "dump.val.fields.CHRG_FAULT.meaning" && condition.value === "thermal_shutdown")
        ? [{ ruleId: "legacy", lineNumber: 2, excerpt: "addr=0x0C val=0x20" }] : [] }));
    const repository = { signalPreview, getSkillSample: async () => sample };
    function Harness() {
      const [value, setValue] = useState(spec);
      const [line, setLine] = useState<number | null>(null);
      return <><SignalsSection skillId="s" spec={value} onChange={(next) => { setValue(next); onChange(next); }} disabled={false} repository={repository} sample={sample} onHit={setLine} />
        <SkillSamplePane skillId="s" repository={repository} apiMode canEdit highlightedLine={line} /></>;
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "展开规则 1" }));
    await choose("规则 1 条件 1类型", "抽取字段");
    await userEvent.click(screen.getByRole("combobox", { name: /^规则 1 条件 1抽取字段：/ }));
    expect(screen.getByRole("option", { name: "dump › charger" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: "VOLTAGE（mV） dump.val.fields.VOLTAGE.value" })).toBeVisible();
    const meaningOption = screen.getByRole("option", { name: "CHRG_FAULT 含义 dump.val.fields.CHRG_FAULT.meaning" });
    expect(within(meaningOption).getByText("CHRG_FAULT 含义").tagName).toBe("STRONG");
    await userEvent.click(meaningOption);
    await choose("规则 1 条件 1值", "thermal_shutdown");
    const condition = { type: "field", field: "dump.val.fields.CHRG_FAULT.meaning", operator: "equals", value: "thermal_shutdown" };
    const picker = screen.getByRole("combobox", { name: `规则 1 条件 1抽取字段：${condition.field}` });
    expect(picker).toHaveAttribute("title", condition.field);
    expect(picker).toHaveAccessibleName(`规则 1 条件 1抽取字段：${condition.field}`);
    expect(picker).toHaveTextContent(condition.field);
    const summary = screen.getByTitle("当 CHRG_FAULT 含义 = thermal_shutdown（dump.val） 时，产生 规则 1 · 警告 · 命中待预览");
    expect(summary).toHaveTextContent("当 CHRG_FAULT 含义 = thermal_shutdown（dump.val） 时，产生 规则 1");
    expect(onChange.mock.lastCall![0].signalRules.rules[0].anyOf[0]).toEqual(condition);
    expect(logSkillSpecSchema.safeParse(onChange.mock.lastCall![0]).success).toBe(true);
    await waitFor(() => expect(screen.getByText(/命中 1 次/)).toBeVisible());
    expect(signalPreview.mock.lastCall![1].parsing).toEqual(spec.parsing);
    await userEvent.click(screen.getByRole("button", { name: "第 2 行：addr=0x0C val=0x20" }));
    const pane = await screen.findByRole("region", { name: "样例内容" });
    expect(within(pane).getByText("addr=0x0C val=0x20").parentElement).toHaveAttribute("data-highlighted", "true");
    await userEvent.click(screen.getByRole("combobox", { name: "规则 1 条件 1比较方式" }));
    expect(screen.queryByRole("option", { name: "在范围内" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "属于集合" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "thermal_shutdown" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "normal" }));
    expect(onChange.mock.lastCall![0].signalRules.rules[0].anyOf[0]).toEqual({ type: "field", field: condition.field, operator: "in", values: ["thermal_shutdown", "normal"] });
    await userEvent.click(screen.getByRole("checkbox", { name: "normal" }));
    expect(onChange.mock.lastCall![0].signalRules.rules[0].anyOf[0].values).toEqual(["thermal_shutdown"]);
    await choose("规则 1 条件 1抽取字段", "VOLTAGE（mV） dump.val.fields.VOLTAGE.value");
    await choose("规则 1 条件 1比较方式", "在范围内");
    expect(onChange.mock.lastCall![0].signalRules.rules[0].anyOf[0]).toEqual({ type: "field", field: "dump.val.fields.VOLTAGE.value", operator: "range", min: 0, max: 100 });
  });
  it("shows Chinese guidance for invalid RE2, unknown fields, reversed ranges and nonpositive windows", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "展开规则 1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "规则 1 条件 1消息正则" }), { target: { value: "(?=bad)" } });
    expect(screen.getAllByRole("alert").some((item) => item.textContent?.includes("正则表达式无效，请检查语法。"))).toBe(true);
    expect(screen.queryByText(/signalRules\.rules/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "预览信号" })).not.toBeInTheDocument();
    cleanup();
    const withCondition = (condition: unknown) => ({ ...initial, signalRules: { ...initial.signalRules!, rules: [{ ...initial.signalRules!.rules[0], anyOf: [condition] }] } }) as SkillSpec;
    setup(withCondition({ type: "field", field: "missing.temp", operator: "equals", value: 1 }));
    expect(screen.getAllByRole("alert").some((item) => item.textContent?.includes("请选择有效的抽取字段。"))).toBe(true);
    cleanup();
    setup(withCondition({ type: "field", field: "status.temp", operator: "range", min: 100, max: 10 }));
    expect(screen.getAllByRole("alert").some((item) => item.textContent?.includes("数值范围无效，请检查上下限。"))).toBe(true);
    cleanup();
    setup(withCondition({ type: "field", field: "status.temp", operator: "range", min: "bad", max: 10 }));
    expect(screen.getAllByRole("alert").some((item) => item.textContent?.includes("数值范围无效，请检查上下限。"))).toBe(true);
    cleanup();
    setup(withCondition({ type: "window", condition: { type: "text", pattern: "error" }, count: 1, seconds: 0 }));
    expect(screen.getAllByRole("alert").some((item) => item.textContent?.includes("时间窗必须大于零。"))).toBe(true);
  });
  it("explains picker truncation and keeps an existing path beyond its cap editable", async () => {
    const spec = structuredClone(initial);
    spec.parsing = { schemaVersion: "parsing/v1", frames: {}, extractors: [{ id: "x", pattern: "(?<v>.+)", fields: { v: { type: "hexbytes", decode: { frame: "F0" } } } }] };
    for (let i = 0; i < 4; i++) spec.parsing.frames![`F${i}`] = { fields: i === 3 ? []
      : Array.from({ length: 32 }, (_, n) => ({ name: `f${n}`, type: "frame", frame: `F${i + 1}` })) };
    spec.parsing.frames!.F0.fields.push({ name: "tail", type: "uint", length: 1 });
    const path = "x.v.fields.tail.value";
    spec.signalRules!.rules[0].anyOf = [{ type: "field", field: path, operator: "equals", value: 7 }];
    setup(spec);
    expect(screen.getByRole("status")).toHaveTextContent("其余路径可在代码视图中配置");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "展开规则 1" }));
    expect(screen.getByRole("combobox", { name: `规则 1 条件 1抽取字段：${path}` })).toHaveTextContent(path);
    await choose("规则 1 条件 1比较方式", "在范围内");
    expect(screen.getByRole("spinbutton", { name: "规则 1 条件 1最小值" })).toHaveValue(0);
  });
  it("never sends a preview for an invalid draft or missing sample", async () => {
    vi.useFakeTimers();
    const signalPreview = vi.fn(async () => result);
    const spec = structuredClone(initial);
    spec.signalRules!.rules[0].anyOf = [{ type: "text", pattern: "(?=invalid)" }];
    setup(spec, { signalPreview });
    expect(screen.getByRole("textbox", { name: "规则 1 条件 1消息正则" })).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(signalPreview).not.toHaveBeenCalled();
    cleanup();
    render(<SignalsSection skillId="s" spec={initial} disabled={false} onChange={vi.fn()} sample={null} repository={{ signalPreview }} onHit={vi.fn()} />);
    expect(screen.getByText("上传样例日志后显示命中次数")).toBeVisible();
    expect(screen.queryByText(/命中待预览/)).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(signalPreview).not.toHaveBeenCalled();
  });
  it("displays Chinese guidance for aggregate rule and condition limits", () => {
    const spec = structuredClone(initial);
    spec.signalRules!.rules = Array.from({ length: 65 }, (_, index) => ({ ...initial.signalRules!.rules[0], id: `rule-${index}` }));
    setup(spec);
    expect(screen.getAllByRole("alert").some((item) => item.textContent?.includes("信号规则数量超出上限，请删减后重试。"))).toBe(true);
    cleanup();
    spec.signalRules!.rules = [{ ...initial.signalRules!.rules[0], anyOf: Array.from({ length: 17 }, () => ({ type: "text", pattern: "error" })) }];
    setup(spec);
    expect(screen.getAllByRole("alert").some((item) => item.textContent?.includes("规则条件数量无效，请新增或删减条件。"))).toBe(true);
  });
  it("previews draft rules on the stored sample, groups hits and jumps to its line", async () => {
    const signalPreview = vi.fn(async () => ({ ...result, truncated: true, reason: "line_cap" as const, hits: [{ ruleId: "legacy", lineNumber: 2, excerpt: "ERROR timeout" }] }));
    const { onHit } = setup(initial, { signalPreview });
    expect(await screen.findByRole("status")).toHaveTextContent("行数上限");
    expect(signalPreview).toHaveBeenCalledWith("s", { signalRules: initial.signalRules, parsing: initial.parsing });
    expect(screen.getByText(/命中 1 次/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /第 2 行/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "展开规则 1" }));
    expect(screen.getByRole("button", { name: "第 2 行：ERROR timeout" })).toHaveTextContent("第 2 行");
    fireEvent.click(screen.getByRole("button", { name: "第 2 行：ERROR timeout" }));
    expect(onHit).toHaveBeenCalledWith(2);
    fireEvent.change(screen.getByRole("textbox", { name: "规则 1名称" }), { target: { value: "New" } });
    expect(screen.queryByRole("button", { name: /第 2 行/ })).not.toBeInTheDocument();
  });
  it("debounces previews, ignores stale responses and automatically retries after another edit", async () => {
    vi.useFakeTimers();
    let resolve!: (value: SignalPreview) => void;
    const signalPreview = vi.fn<NonNullable<SkillWorkspaceRepository["signalPreview"]>>().mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
      .mockRejectedValueOnce(new Error("offline")).mockResolvedValue(result);
    setup(initial, { signalPreview });
    fireEvent.click(screen.getByRole("button", { name: "展开规则 1" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(399); });
    expect(signalPreview).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(signalPreview).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("textbox", { name: "规则 1名称" }), { target: { value: "New" } });
    await act(async () => resolve({ ...result, hits: [{ ruleId: "legacy", lineNumber: 2, excerpt: "old" }] }));
    expect(screen.queryByRole("button", { name: /第 2 行/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "规则 1名称" }), { target: { value: "Newer" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(signalPreview).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toHaveTextContent("预览失败");
    fireEvent.change(screen.getByRole("textbox", { name: "规则 1名称" }), { target: { value: "Newest" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(signalPreview).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("renders read-only rules and highlights the selected sample line", async () => {
    const onChange = vi.fn();
    render(<SignalsSection skillId="s" spec={initial} disabled onChange={onChange} sample={null} onHit={() => undefined} />);
    expect(screen.getByRole("button", { name: "添加信号规则" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "展开规则 1" }));
    expect(screen.getByRole("textbox", { name: "规则 1名称" })).toBeDisabled();
    expect(screen.getByText("上传样例日志后显示命中次数")).toBeVisible();
    cleanup();
    render(<SkillSamplePane skillId={mockSkillSample.skillId} repository={{ getSkillSample: async () => mockSkillSample }} apiMode canEdit highlightedLine={2} />);
    const pane = await screen.findByRole("region", { name: "样例内容" });
    expect(within(pane).getByText("ERROR charging timeout code=E_TIMEOUT").parentElement).toHaveAttribute("data-highlighted", "true");
  });
});
