import { useState } from "react";
import { stringify, parse } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parsingSpecSchema } from "@wiseeff/dto-schemas";
import { DecodingSection, RegisterBitBar } from "./DecodingSection";
import { SkillSamplePane } from "./SkillSamplePane";
import { mockSkillSample } from "@/infrastructure/mock/logSkills";
import type { ParsePreview, SkillSpec, SkillWorkspaceRepository } from "./types";

afterEach(cleanup);
const spec: NonNullable<SkillSpec["parsing"]> = {
  schemaVersion: "parsing/v1",
  registers: { REG0C: { width: 8, fields: [{ bits: [7, 7], name: "WATCHDOG_FAULT" }, { bits: [5, 4], name: "CHRG_FAULT", enum: { "2": "thermal_shutdown" } }, { bits: [2, 0], name: "NTC_FAULT" }] } },
  registerMaps: { charger: { selectBy: "addr", cases: { "0x0C": "REG0C" } } },
  extractors: [{ id: "dump", pattern: "addr=(?<addr>\\S+) val=(?<val>\\S+)", fields: { addr: { type: "uint" }, val: { type: "uint", decode: { registerMap: "charger" } } } }]
};
const sample = { ...mockSkillSample, content: "unmatched\naddr=0x0C val=0x20", lineCount: 2 };
const preview: ParsePreview = { valid: true, truncated: false, issues: [], counts: { total: 1, byExtractor: { dump: 1 }, errors: {} }, unmatchedLineCount: 0,
  events: [{ v: 1, source: "declarative", file: sample.fileName, line: 2, extractor: "dump", fields: {
    addr: { raw: "0x0C", value: 12 }, val: { raw: "0x20", value: 32, fields: { WATCHDOG_FAULT: { raw: "0", value: 0 }, CHRG_FAULT: { raw: "2", value: 2, meaning: "thermal_shutdown" }, NTC_FAULT: { raw: "0", value: 0 } } }
  } }]
};
function setup(repository: Partial<SkillWorkspaceRepository> = { parsePreview: vi.fn(async () => preview) }, disabled = false, initial = spec) {
  function Harness() {
    const [yaml, setYaml] = useState(stringify(initial));
    const [line, setLine] = useState<number | null>(null);
    return <><DecodingSection skillId={sample.skillId} yaml={yaml} onChange={setYaml} disabled={disabled} repository={repository} sample={sample} selectedLine={line} />
      <SkillSamplePane skillId={sample.skillId} apiMode canEdit repository={{ getSkillSample: async () => sample }} onLineSelect={setLine} selectedLine={line} /></>;
  }
  render(<Harness />); return repository;
}
describe("register decoding workspace", () => {
  it.each([8, 16, 32, 64] as const)("aligns all %s ruler cells and full-width segments on one grid", (width) => {
    const register = structuredClone(spec.registers!.REG0C);
    register.width = width;
    if (width === 8) {
      register.fields.splice(1, 0, { bits: [6, 6], name: "BOOST_FAULT" });
      register.fields.splice(3, 0, { bits: [3, 3], name: "BAT_FAULT" });
    } else register.fields = [{ bits: [width - 1, width - 1], name: "HIGH" }, { bits: [width - 2, 1], name: "BODY" }, { bits: [0, 0], name: "LOW" }];
    const { container } = render(<RegisterBitBar register={register} />);
    const ruler = screen.getByRole("list", { name: "位编号，高位到低位" }), cells = within(ruler).getAllByRole("listitem");
    expect(cells).toHaveLength(width);
    expect(cells.map((cell) => cell.getAttribute("aria-label"))).toEqual(Array.from({ length: width }, (_, i) => `位 ${width - 1 - i}`));
    expect(cells.at(-1)).toHaveTextContent("0");
    const layout = ruler.parentElement!;
    expect(layout).toHaveStyle({ gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))` });
    const segments = [...container.querySelectorAll<HTMLElement>(".skill-bit-segment")];
    expect(segments.every((segment) => segment.parentElement?.parentElement === layout)).toBe(true);
    const spans = segments.map((segment) => Number(segment.style.gridColumn.split("span ")[1]));
    expect(spans.reduce((sum, span) => sum + span, 0)).toBe(width);
    segments.forEach((segment) => {
      const [start, span] = segment.style.gridColumn.split(" / span ").map(Number);
      expect(start + span).toBeLessThanOrEqual(width + 1);
      expect(segment.style.gridRow).toBe("2");
    });
    cells.forEach((cell, i) => {
      expect(cell.style.gridColumn).toBe(String(i + 1));
      expect(cell.style.gridRow).toBe("1");
      const bit = width - 1 - i;
      if (width < 32) expect(cell.textContent).toBe(String(bit));
      else if (cell.textContent) expect(bit === width - 1 || bit % 4 === 0 || register.fields.some((field) => field.bits.includes(bit))).toBe(true);
    });
    if (width >= 32) {
      const labels = cells.filter((cell) => cell.textContent).map((cell) => Number(cell.textContent));
      expect(labels[0]).toBe(width - 1);
      labels.slice(1).forEach((bit, index) => expect(labels[index] - bit).toBeGreaterThanOrEqual(3));
    }
  });
  it("orders bit segments high to low and shows selected sample values from the unsaved preview endpoint", async () => {
    const repository = setup();
    const bar = screen.getByRole("group", { name: /寄存器位条/ });
    expect(within(bar).queryByRole("list", { name: "解码字段图例" })).not.toBeInTheDocument();
    expect(within(bar).getAllByRole("strong").map((element) => element.textContent)).toEqual(["WATCHDOG_FAULT", "CHRG_FAULT", "NTC_FAULT"]);
    await userEvent.click(await screen.findByRole("button", { name: "选择样例第 2 行：addr=0x0C val=0x20" }));
    expect(await within(bar).findByText("CHRG_FAULT = 2 · thermal_shutdown")).toBeVisible();
    expect(within(bar).getByLabelText("WATCHDOG_FAULT 的值")).toHaveTextContent("0");
    expect(within(bar).getByLabelText("NTC_FAULT 的值")).toHaveTextContent("0");
    expect(repository.parsePreview).toHaveBeenCalledWith(sample.skillId, { parsing: spec, sampleText: sample.content, fileName: sample.fileName });
    expect(screen.getByRole("button", { name: /选择样例第 2 行/ })).toHaveAttribute("aria-pressed", "true");
  });
  it.each([["output_field_cap", "32768 个字段输出上限"], ["output_byte_cap", "4 MiB 输出上限"]] as const)("identifies the actual preview output limit: %s", async (reason, message) => {
    setup({ parsePreview: vi.fn(async () => ({ ...preview, truncated: true, reason })) });
    await userEvent.click(await screen.findByRole("button", { name: /选择样例第 2 行/ }));
    expect(await screen.findByRole("status")).toHaveTextContent(message);
    expect(screen.getByRole("status")).not.toHaveTextContent("500 个事件");
  });
  it.each([["+0x0C", 12], ["-0x0C", -12]])("uses the engine's normalized map key for %s", async (key, address) => {
    const initial = structuredClone(spec);
    initial.registerMaps!.charger.cases = { [key]: "REG0C" };
    const result = structuredClone(preview);
    result.events[0].fields.addr = { raw: String(key), value: address };
    setup({ parsePreview: vi.fn(async () => result) }, false, initial);
    await userEvent.click(await screen.findByRole("button", { name: /选择样例第 2 行/ }));
    expect(await screen.findByText("CHRG_FAULT = 2 · thermal_shutdown")).toBeVisible();
  });
  it("retains sample context for multiline events containing the selected line", async () => {
    const result = structuredClone(preview);
    result.events[0].line = 1; result.events[0].endLine = 2;
    const repository = setup({ parsePreview: vi.fn(async () => result) });
    await userEvent.click(await screen.findByRole("button", { name: /选择样例第 2 行/ }));
    expect(await screen.findByText("CHRG_FAULT = 2 · thermal_shutdown")).toBeVisible();
    expect(repository.parsePreview).toHaveBeenCalledWith(sample.skillId, expect.objectContaining({ sampleText: sample.content }));
  });
  it("ignores late previews from a previously selected sample line", async () => {
    let complete!: (value: ParsePreview) => void;
    const repository = { parsePreview: vi.fn().mockImplementationOnce(() => new Promise<ParsePreview>((resolve) => { complete = resolve; })).mockResolvedValueOnce({ ...preview, events: [] }) };
    setup(repository);
    await userEvent.click(await screen.findByRole("button", { name: /选择样例第 2 行/ }));
    await userEvent.click(screen.getByRole("button", { name: /选择样例第 1 行/ }));
    await waitFor(() => expect(screen.getByText(/此行未产生该寄存器/)).toBeVisible());
    await act(async () => complete(preview));
    expect(screen.queryByText("CHRG_FAULT = 2 · thermal_shutdown")).not.toBeInTheDocument();
  });
  it("edits every field property and round trips the same form spec through YAML", async () => {
    setup();
    fireEvent.change(screen.getByRole("textbox", { name: "字段 1 位范围" }), { target: { value: "7:6" } });
    fireEvent.blur(screen.getByRole("textbox", { name: "字段 1 位范围" }));
    fireEvent.change(screen.getByRole("textbox", { name: "字段 1 名称" }), { target: { value: "STATUS" } });
    fireEvent.change(screen.getByRole("textbox", { name: "字段 1 枚举" }), { target: { value: '{"0":"normal"}' } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "字段 1 比例" }), { target: { value: "0.5" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "字段 1 偏移" }), { target: { value: "-1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "字段 1 单位" }), { target: { value: "mV" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "字段 1 有符号" }));
    fireEvent.change(screen.getByRole("textbox", { name: "字段 1 说明" }), { target: { value: "Physical status" } });
    await userEvent.click(screen.getByRole("tab", { name: "代码视图" }));
    const editor = screen.getByRole("textbox", { name: "代码视图 · YAML" });
    const result = parse((editor as HTMLTextAreaElement).value);
    expect(result.registers.REG0C.fields[0]).toEqual({ bits: [7, 6], name: "STATUS", enum: { "0": "normal" }, scale: 0.5, offset: -1, unit: "mV", signed: true, description: "Physical status" });
    expect(parsingSpecSchema.safeParse(result).success).toBe(true);
    fireEvent.change(editor, { target: { value: stringify(result) } });
    await userEvent.click(screen.getByRole("tab", { name: "表单" }));
    expect(screen.getByRole("textbox", { name: "字段 1 名称" })).toHaveValue("STATUS");
    expect(screen.getByRole("spinbutton", { name: "字段 1 比例" })).toHaveValue(0.5);
  });
  it("previews paste errors per line and imports only valid rows", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "粘贴寄存器表" }));
    const dialog = screen.getByRole("dialog", { name: "粘贴寄存器表" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "数据手册表格" }), { target: { value: "Bits,Name,Description\n7:5,FLAGS,Status\nbad,BROKEN,Bad range\n2:0,FAULT,Fault" } });
    const table = within(dialog).getByRole("table", { name: "寄存器表预览" });
    expect(await within(table).findByText(/位范围无法识别/)).toBeVisible();
    expect(dialog).toHaveAccessibleDescription(/确认后将替换当前寄存器的全部字段/);
    expect(within(dialog).getByRole("status")).toHaveTextContent("可导入 2 行 · 1 行无法识别");
    const invalidRow = within(table).getByText(/位范围无法识别/).closest("tr")!;
    expect(invalidRow).toHaveAttribute("data-tone", "invalid");
    expect(invalidRow).toHaveAccessibleDescription(/位范围无法识别/);
    expect(invalidRow.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(within(table).getByText(/FLAGS/).closest("tr")).toHaveAttribute("data-tone", "valid");
    expect(within(table).getByText("3")).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "替换当前字段并导入（2）" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "字段 1 名称" })).toHaveValue("FLAGS");
    expect(screen.getByRole("textbox", { name: "字段 2 名称" })).toHaveValue("FAULT");
    expect(screen.queryByRole("textbox", { name: "字段 3 名称" })).not.toBeInTheDocument();
  });
  it("rejects oversized or overlong pastes inline and recovers to an importable preview", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "粘贴寄存器表" }));
    const dialog = screen.getByRole("dialog", { name: "粘贴寄存器表" });
    const input = within(dialog).getByRole("textbox", { name: "数据手册表格" });
    fireEvent.change(input, { target: { value: `7${" ".repeat(200 * 1024)}X` } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("64 KiB");
    expect(input).toHaveAccessibleDescription(/64 KiB/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByRole("button", { name: /替换当前字段并导入/ })).toBeDisabled();
    fireEvent.change(input, { target: { value: "\n".repeat(512) } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("512 行");
    fireEvent.change(input, { target: { value: "7:5,FLAGS,Status" } });
    expect(await within(dialog).findByText("可导入 1 行 · 0 行无法识别")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "替换当前字段并导入（1）" })).toBeEnabled();
  });
  it.each(["unmatched_register", "register_case"])("shows only the localized unmatched warning for %s", async (code) => {
    const result = structuredClone(preview);
    result.events[0].line = 1;
    result.events[0].fields.addr = { raw: "0x0B", value: 11 };
    result.events[0].fields.val = { raw: "0x2c", value: 44 };
    result.events[0].errors = [{ field: "val", code, message: "No register case for addr=0x0B (map charger)" }];
    render(<DecodingSection skillId={sample.skillId} yaml={stringify(spec)} onChange={vi.fn()} disabled={false}
      repository={{ parsePreview: vi.fn(async () => result) }} sample={{ ...sample, content: "addr=0x0B val=0x2c", lineCount: 1 }} selectedLine={1} />);
    const warning = await screen.findByRole("status");
    expect(warning).toHaveTextContent(/^addr=0x0B 未匹配寄存器映射 charger$/);
    expect(warning).toHaveAttribute("title", "No register case for addr=0x0B (map charger)");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/No register case|addr=11|此行未产生该寄存器/)).not.toBeInTheDocument();
  });
  it.each([
    ["register_range", "寄存器数值超出位宽或物理值范围。"], ["register_precision", "寄存器数值换算超出安全精度范围。"],
    ["event_size", "解码事件过大，部分字段已省略。"], ["field_cap", "解码字段数量超过上限，部分字段已省略。"],
    ["byte_cap", "解码字节数超过上限。"], ["invalid_field", "字段值无法按声明的类型解析。"],
    ["future_code", "解码失败，请检查字段定义和样例内容。"], ["constructor", "解码失败，请检查字段定义和样例内容。"]
  ])("localizes %s while retaining its diagnostic only in the title", async (code, message) => {
    const result = structuredClone(preview);
    result.events[0].fields.val = { raw: "0x20", value: 32 };
    result.events[0].errors = [{ field: "val", code, message: "Raw engine diagnostic" }];
    setup({ parsePreview: vi.fn(async () => result) });
    await userEvent.click(await screen.findByRole("button", { name: /选择样例第 2 行/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`val：${message}`);
    expect(alert).toHaveAttribute("title", `${code}: Raw engine diagnostic`);
    expect(screen.queryByText(/Raw engine diagnostic|此行未产生该寄存器/)).not.toBeInTheDocument();
  });
  it("omits cleared optional field properties from YAML", async () => {
    setup();
    fireEvent.change(screen.getByRole("textbox", { name: "字段 2 枚举" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "字段 2 比例" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "字段 2 比例" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "字段 2 单位" }), { target: { value: "V" } });
    fireEvent.change(screen.getByRole("textbox", { name: "字段 2 单位" }), { target: { value: "" } });
    await userEvent.click(screen.getByRole("tab", { name: "代码视图" }));
    const result = parse((screen.getByRole("textbox", { name: "代码视图 · YAML" }) as HTMLTextAreaElement).value);
    expect(result.registers.REG0C.fields[1]).toEqual({ bits: [5, 4], name: "CHRG_FAULT" });
    expect(parsingSpecSchema.safeParse(result).success).toBe(true);
  });
  it("edits map cases and decoder bindings using shared selects", async () => {
    setup();
    fireEvent.change(screen.getByRole("textbox", { name: "charger 条件 1" }), { target: { value: "0x0D" } });
    await userEvent.click(screen.getByRole("combobox", { name: "dump.val 解码器" }));
    await userEvent.click(screen.getByRole("option", { name: "寄存器 · REG0C" }));
    expect(screen.getByRole("combobox", { name: "dump.val 解码器" })).toHaveAttribute("data-value", "register:REG0C");
    await userEvent.click(screen.getByRole("tab", { name: "代码视图" }));
    const result = parse((screen.getByRole("textbox", { name: "代码视图 · YAML" }) as HTMLTextAreaElement).value);
    expect(result.registerMaps.charger.cases).toEqual({ "0x0D": "REG0C" });
    expect(result.extractors[0].fields.val.decode).toEqual({ register: "REG0C" });
    expect(parsingSpecSchema.safeParse(result).success).toBe(true);
  });
  it("keeps read-only editing disabled and displays a preview error", async () => {
    const repository = { parsePreview: vi.fn(async () => { throw new Error("offline"); }) };
    setup(repository, true);
    expect(screen.getByRole("textbox", { name: "字段 1 名称" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "粘贴寄存器表" })).toBeDisabled();
    await userEvent.click(await screen.findByRole("button", { name: /选择样例第 2 行/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("样例解码失败"));
  });
  it("shows values without relying on color", () => {
    const register = structuredClone(spec.registers!.REG0C);
    register.fields[1].description = "Charge fault reason";
    render(<RegisterBitBar register={register} values={preview.events[0].fields.val && typeof preview.events[0].fields.val === "object" && "fields" in preview.events[0].fields.val ? preview.events[0].fields.val.fields : undefined} />);
    expect(screen.queryByText("[5:4] Charge fault reason")).not.toBeInTheDocument();
    expect(screen.getByText("CHRG_FAULT")).toBeVisible();
    expect(screen.getByText("CHRG_FAULT = 2 · thermal_shutdown")).toBeVisible();
    expect(screen.getByText("CHRG_FAULT = 2 · thermal_shutdown").closest("li")).toHaveAttribute("title", "CHRG_FAULT [5:4] · Charge fault reason");
    expect(within(screen.getByRole("list", { name: "位编号，高位到低位" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["7", "6", "5", "4", "3", "2", "1", "0"]);
    const chip = screen.getByLabelText("CHRG_FAULT 的值（非零）");
    expect(chip).toHaveTextContent("2");
    expect(chip.closest(".skill-bit-segment")).toHaveAttribute("data-nonzero", "true");
    expect(chip.closest(".skill-bit-segment")).toHaveStyle({ gridColumn: "3 / span 2" });
    expect(screen.getByText("CHRG_FAULT").parentElement).toHaveAttribute("title", "CHRG_FAULT [5:4] · Charge fault reason");
  });
});
