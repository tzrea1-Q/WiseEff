import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parsingSpecSchema } from "@wiseeff/dto-schemas";
import { DecodingSection } from "./DecodingSection";
import { FrameEditor, frameOffsets, renameFrameReferences } from "./FrameEditor";
import { mockSkillSample } from "@/infrastructure/mock/logSkills";
import type { ParsePreview, SkillSpec } from "./types";
import { decodeLogFiles } from "../../../server/modules/logs/parsing/engine";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
type Parsing = NonNullable<SkillSpec["parsing"]>;
const spec: Parsing = { schemaVersion: "parsing/v1", frames: {
  packet: { endian: "little", fields: [{ name: "size", type: "uint", length: 1 }, { name: "payload", type: "bytes", length: "size" },
    { name: "status", type: "uint", length: 1 }, { name: "sum", type: "checksum", algorithm: "sum8", range: [0, 4], length: 1 }] }
}, extractors: [{ id: "wire", pattern: "data=(?<data>.+)", fields: { data: { type: "hex", decode: { frame: "packet" } } } }] };
const preview: ParsePreview = { valid: true, truncated: false, issues: [], counts: { total: 1, byExtractor: { wire: 1 }, errors: {} }, unmatchedLineCount: 0,
  events: [{ v: 1, source: "declarative", file: "sample.log", line: 1, extractor: "wire", fields: { data: { raw: "02 A0 B0 03 55", value: { hex: "02A0B00355", length: 5 }, fields: {
    size: { raw: "02", value: 2, byteOffset: 0, byteLength: 1 }, payload: { raw: "A0B0", value: { hex: "A0B0", length: 2 }, byteOffset: 1, byteLength: 2 },
    status: { raw: "03", value: 3, byteOffset: 3, byteLength: 1 }, sum: { raw: "55", value: 85, byteOffset: 4, byteLength: 1, checksum: { expected: 85, actual: 85, ok: true } }
  } } } }] };
const pdSpec: Parsing = { schemaVersion: "parsing/v1", registers: {
  header: { width: 16, fields: [{ name: "messageType", bits: [4, 0], enum: { "1": "Source_Capabilities" } }, { name: "count", bits: [14, 12] }] },
  pdo: { width: 32, fields: [{ name: "voltage", bits: [19, 10], scale: 50, unit: "mV" }, { name: "current", bits: [9, 0], scale: 10, unit: "mA" }] }
}, frames: {
  pdo: { fields: [{ name: "pdo", type: "uint", length: 4, endian: "little", register: "pdo" }] },
  message: { fields: [{ name: "hdr", type: "uint", length: 2, endian: "little", register: "header" }, { name: "objects", type: "repeat", frame: "pdo", count: "hdr.count" }] }
}, extractors: [{ id: "usb", pattern: "usbpd: rx frame=(?<frame>[0-9A-Fa-f]+)", fields: { frame: { type: "hex", decode: { frame: "message" } } } }] };
const pdSample = { ...mockSkillSample, content: "usbpd: rx frame=61212C9101082CD10200\nusbpd: rx frame=6121", lineCount: 2 };
const pdPreview: ParsePreview = { ...decodeLogFiles(parsingSpecSchema.parse(pdSpec), [{ file: pdSample.fileName, lines: pdSample.content.split("\n") }]), valid: true, issues: [], truncated: false };

function editor(events = preview.events, initial = spec, disabled = false) {
  function Harness() {
    const [value, setValue] = useState(initial);
    return <FrameEditor spec={value} onChange={setValue} disabled={disabled} events={events} selectedLine={1} pending={false} />;
  }
  return render(<Harness />);
}

describe("frame workspace", () => {
  it("renders the exact F0–F7 shared-reference graph quickly with one length calculation per definition", () => {
    const reads: Record<string, number> = {};
    const frames: NonNullable<Parsing["frames"]> = Object.fromEntries(Array.from({ length: 8 }, (_, level) => {
      const id = `F${level}`, fields: NonNullable<Parsing["frames"]>[string]["fields"] = level === 7 ? [] : Array.from({ length: 64 }, (_, index) => ({ name: `f${index}`, type: "frame", frame: `F${level + 1}` }));
      return [id, { get fields() { reads[id] = (reads[id] ?? 0) + 1; if (reads[id] > 100) throw new Error("Unbounded frame expansion"); return fields; } }];
    }));
    const initial: Parsing = { schemaVersion: "parsing/v1", frames, extractors: [{ id: "shared", pattern: "(?<frame>.+)", fields: { frame: { type: "hex", decode: { frame: "F0" } } } }] };
    expect(parsingSpecSchema.safeParse(initial).success).toBe(true);
    for (const key of Object.keys(reads)) reads[key] = 0;
    const started = performance.now();
    const markup = renderToStaticMarkup(<FrameEditor spec={initial} onChange={() => {}} disabled={false} events={[]} selectedLine={1} pending={false} />);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(markup.match(/aria-label="帧字段 \d+ 名称"/g)).toHaveLength(64);
    for (let level = 1; level < 8; level++) expect(reads[`F${level}`]).toBe(1);
  });

  it("defaults to the decoded top-level USB-PD frame and selects whole repeat and individual item ranges", async () => {
    editor(pdPreview.events.filter((event) => event.line === 1), pdSpec);
    expect(screen.getByRole("combobox", { name: "选择帧" })).toHaveTextContent("message");
    const hex = screen.getByRole("group", { name: "帧十六进制视图" });
    expect(within(hex).getAllByRole("button")).toHaveLength(10);
    expect(screen.getByLabelText("hdr 解码值")).toHaveTextContent(/^8545 \(0x2161\)$/);
    expect(screen.getByLabelText("objects 解码值")).toHaveTextContent("2c9101082cd10200");
    await userEvent.click(screen.getByRole("button", { name: "选择帧字段 objects" }));
    expect(within(hex).getAllByRole("button", { pressed: true })).toHaveLength(8);
    await userEvent.click(screen.getByRole("button", { name: "选择重复项 objects › 0" }));
    expect(within(hex).getAllByRole("button", { pressed: true })).toHaveLength(4);
    await userEvent.click(within(hex).getByRole("button", { name: "字节 6：2C，字段 objects，重复项 1" }));
    expect(screen.getByRole("button", { name: "选择重复项 objects › 1" })).toHaveAttribute("aria-pressed", "true");
    expect(within(hex).getAllByRole("button", { pressed: true }).map((item) => item.getAttribute("aria-label"))).toEqual([
      "字节 6：2C，字段 objects，重复项 1", "字节 7：D1，字段 objects，重复项 1", "字节 8：02，字段 objects，重复项 1", "字节 9：00，字段 objects，重复项 1"
    ]);
    expect(screen.getByRole("button", { name: "选择帧字段 objects" })).toHaveAttribute("aria-pressed", "true");
  });

  it("finds both nested PDO registers, shows their paths and lets the author choose an occurrence", async () => {
    const repository = { parsePreview: vi.fn(async () => pdPreview) };
    render(<DecodingSection skillId={pdSample.skillId} yaml={stringify(pdSpec)} onChange={() => {}} disabled={false} repository={repository} sample={pdSample} selectedLine={1} />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "选择帧" })).toHaveTextContent("message"));
    await userEvent.click(screen.getByRole("combobox", { name: "选择寄存器" }));
    await userEvent.click(screen.getByRole("option", { name: "pdo" }));
    const bitbar = screen.getByRole("group", { name: "寄存器位条 · 32 位，高位到低位" });
    expect(within(bitbar).getByLabelText("voltage 的值（非零）")).toHaveTextContent("5000 mV");
    expect(screen.getByLabelText("寄存器样例路径")).toHaveTextContent("frame › objects › 0 › pdo");
    expect(screen.queryByText(/此行未产生该寄存器/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "寄存器解码位置" }));
    await userEvent.click(screen.getByRole("option", { name: "frame › objects › 1 › pdo" }));
    expect(within(bitbar).getByLabelText("voltage 的值（非零）")).toHaveTextContent("9000 mV");
    expect(screen.getByLabelText("寄存器样例路径")).toHaveTextContent("frame › objects › 1 › pdo");
  });

  it("prefers a decoded top-level payload over a failed capture of the same frame", () => {
    const initial = structuredClone(pdSpec), failed = structuredClone(pdPreview.events[1]);
    initial.extractors.unshift({ ...initial.extractors[0], id: "failed" });
    failed.extractor = "failed"; failed.line = 1;
    editor([failed, pdPreview.events[0]], initial);
    expect(within(screen.getByRole("group", { name: "帧十六进制视图" })).getAllByRole("button")).toHaveLength(10);
    expect(screen.getByLabelText("hdr 解码值")).toHaveTextContent("8545");
  });

  it("resets the frame default on sample selection and localizes a truncated PDO warning with raw details", async () => {
    function Harness() {
      const [line, setLine] = useState(1);
      return <><button onClick={() => setLine(2)}>选择截断行</button><FrameEditor spec={pdSpec} onChange={() => {}} disabled={false} events={pdPreview.events.filter((event) => event.line === line)} selectedLine={line} pending={false} /></>;
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "选择重复项 objects › 1" }));
    await userEvent.click(screen.getByRole("combobox", { name: "选择帧" }));
    await userEvent.click(screen.getByRole("option", { name: "pdo" }));
    await userEvent.click(screen.getByRole("button", { name: "选择截断行" }));
    expect(screen.getByRole("combobox", { name: "选择帧" })).toHaveTextContent("message");
    expect(screen.queryByText(/^已选字段：/)).not.toBeInTheDocument();
    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent("字段 pdo 需要 4 个字节（偏移 0），仅剩 0 个字节");
    expect(warning).toHaveAttribute("title", "frame_range: Field pdo requires 4 bytes at offset 0; only 0 remain");
    expect(warning).toHaveClass("skill-register-unmatched");
    expect(warning.querySelector("svg")).not.toBeNull();
    expect(within(screen.getByRole("group", { name: "帧十六进制视图" })).getAllByRole("button")).toHaveLength(2);
  });

  it("computes fixed and relative offsets, including nested frames and constant repeats", () => {
    expect(frameOffsets(spec.frames!.packet, spec.frames!)).toEqual([{ offset: "0", length: 1 }, { offset: "1", length: undefined }, { offset: "+0 after payload", length: 1 }, { offset: "+1 after payload", length: 1 }]);
    const frames = { word: { fields: [{ name: "word", type: "uint" as const, length: 2 as const }] } };
    expect(frameOffsets({ fields: [{ name: "words", type: "repeat", frame: "word", count: 3, multiplier: 2 }, { name: "end", type: "uint", length: 1 }] }, frames))
      .toEqual([{ offset: "0", length: 12 }, { offset: "12", length: 1 }]);
    expect(frameOffsets({ fields: [{ name: "child", type: "frame", frame: "word", length: "size" }, { name: "end", type: "uint", length: 1 }] }, frames))
      .toEqual([{ offset: "0", length: undefined }, { offset: "+0 after child", length: 1 }]);
    expect(frameOffsets({ fields: [{ name: "choice", type: "switch", on: "size", cases: {}, length: 2 }, { name: "tags", type: "tlv", tagSize: 1, lengthSize: 1, cases: {}, length: 2 }, { name: "end", type: "uint", length: 1 }] }, frames))
      .toEqual([{ offset: "0", length: undefined }, { offset: "+0 after choice", length: undefined }, { offset: "+0 after tags", length: 1 }]);
  });

  it("links field selection to bytes and byte selection to the field with text and pressed states", async () => {
    editor();
    await userEvent.click(screen.getByRole("button", { name: "选择帧字段 payload" }));
    expect(screen.getByText("已选字段：payload（边框与粗体标记字节）")).toBeVisible();
    const hex = screen.getByRole("group", { name: "帧十六进制视图" });
    expect(within(hex).getAllByRole("button", { pressed: true }).map((byte) => byte.getAttribute("aria-label"))).toEqual(["字节 1：A0，字段 payload", "字节 2：B0，字段 payload"]);
    expect(within(hex).getByRole("button", { name: "字节 1：A0，字段 payload" })).toHaveTextContent(/^A0$/);
    await userEvent.click(within(hex).getByRole("button", { name: "字节 3：03，字段 status" }));
    expect(screen.getByRole("button", { name: "选择帧字段 status" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "选择帧字段 payload" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("status 解码值")).toHaveTextContent("3");
    expect(screen.getByText("+1 after payload")).toBeVisible();
    expect(screen.getByRole("status", { name: "sum 校验状态" })).toHaveTextContent("✓ 校验通过 · 期望 85 / 实际 85");
  });

  it("shows a failing checksum inline and safely defaults to four bytes per row before measuring", () => {
    const result = structuredClone(preview);
    const data = result.events[0].fields.data;
    if (!data || typeof data !== "object" || !("fields" in data) || !data.fields) throw new Error("Missing frame fixture");
    data.raw = "00".repeat(17);
    data.value = { hex: "00".repeat(17), length: 17 };
    const sum = data.fields.sum;
    if (sum && typeof sum === "object" && "checksum" in sum) sum.checksum = { expected: 85, actual: 0, ok: false };
    const { container } = editor(result.events);
    expect(screen.getByRole("status", { name: "sum 校验状态" })).toHaveTextContent("✕ 校验失败 · 期望 85 / 实际 0");
    expect([...container.querySelectorAll(".skill-frame-hex-row")].map((row) => row.querySelectorAll("button").length)).toEqual([4, 4, 4, 4, 1]);
    expect(screen.getByText("0010")).toBeVisible();
  });

  it("fits sixteen, eight or four bytes to the column and keeps selected byte text at constant width", async () => {
    let width = 470, resize = () => {};
    const disconnect = vi.fn(), originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("skill-frame-hex")) return new DOMRect(0, 0, width, 0);
      if (this.classList.contains("skill-frame-hex-offset")) return new DOMRect(0, 0, 40, 0);
      return originalRect.call(this);
    });
    vi.stubGlobal("ResizeObserver", class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) { if (target.classList.contains("skill-frame-hex")) resize = () => this.callback([], this as unknown as ResizeObserver); }
      disconnect = disconnect;
    });
    const { container, unmount } = editor(pdPreview.events.filter((event) => event.line === 1), pdSpec);
    const rowSizes = () => [...container.querySelectorAll(".skill-frame-hex-row")].map((row) => row.querySelectorAll("button").length);
    const gutters = () => [...container.querySelectorAll(".skill-frame-hex-offset")].map((item) => item.textContent);
    expect(rowSizes()).toEqual([8, 2]);
    expect(gutters()).toEqual(["0000", "0008"]);
    const hex = screen.getByRole("group", { name: "帧十六进制视图" });
    const before = within(hex).getAllByRole("button").map((item) => item.textContent);
    await userEvent.click(screen.getByRole("button", { name: "选择帧字段 objects" }));
    expect(within(hex).getAllByRole("button").map((item) => item.textContent)).toEqual(before);
    expect(within(hex).getAllByRole("button", { pressed: true })).toHaveLength(8);
    expect(within(hex).queryByText(/▶/)).not.toBeInTheDocument();
    width = 800; act(() => resize());
    expect(rowSizes()).toEqual([10]);
    expect(container.querySelector(".skill-frame-hex-row")).toHaveStyle({ gridTemplateColumns: "minmax(0, var(--space-10)) repeat(16, minmax(0, 1fr))" });
    width = 200; act(() => resize());
    expect(rowSizes()).toEqual([4, 4, 2]);
    expect(gutters()).toEqual(["0000", "0004", "0008"]);
    await userEvent.click(within(hex).getByRole("button", { name: "字节 8：02，字段 objects，重复项 1" }));
    expect(within(hex).getAllByRole("button", { pressed: true })).toHaveLength(4);
    unmount(); expect(disconnect).toHaveBeenCalled();
  });

  it.each([
    [-2, {}, "-2 (-0x2)"],
    ["18446744073709551615", {}, "18446744073709551615 (0xffffffffffffffff)"],
    [8545, { unit: "mV" }, "8545 mV"],
    [8545, { meaning: "Source_Capabilities" }, "8545 (Source_Capabilities)"],
    [0.5, {}, "0.5"]
  ] as const)("formats integer sample %s without altering physical or enum values", (value, metadata, expected) => {
    const initial = structuredClone(pdSpec), events = structuredClone(pdPreview.events.filter((event) => event.line === 1));
    const frame = events[0].fields.frame;
    if (!frame || typeof frame !== "object" || !("fields" in frame) || !frame.fields) throw new Error("Missing frame fixture");
    frame.fields.hdr = { raw: "6121", value, ...metadata };
    initial.frames!.message.fields[0] = { name: "hdr", type: typeof value === "number" && value < 0 ? "int" : "uint", length: 8 };
    editor(events, initial);
    expect(screen.getByLabelText("hdr 解码值")).toHaveTextContent(expected);
    expect(screen.getByLabelText("hdr 解码值").textContent).toBe(expected);
  });

  it("renders hex bytes from the decoded byte value when the original capture is base64", async () => {
    const initial = structuredClone(spec), result = structuredClone(preview);
    initial.extractors[0].fields.data = { type: "base64bytes", decode: { frame: "packet" } };
    const data = result.events[0].fields.data;
    if (!data || typeof data !== "object" || !("raw" in data)) throw new Error("Missing frame fixture");
    data.raw = "AqCwA1U=";
    editor(result.events, initial);
    const hex = screen.getByRole("group", { name: "帧十六进制视图" });
    expect(within(hex).getAllByRole("button")).toHaveLength(5);
    await userEvent.click(within(hex).getByRole("button", { name: "字节 1：A0，字段 payload" }));
    expect(screen.getByRole("button", { name: "选择帧字段 payload" })).toHaveAttribute("aria-pressed", "true");
    expect(within(hex).getByRole("button", { name: "字节 2：B0，字段 payload" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows nested frame bytes with offsets relative to the selected frame", async () => {
    const initial = structuredClone(spec), result = structuredClone(preview);
    initial.frames!.packet.fields = [{ name: "size", type: "uint", length: 1 }, { name: "child", type: "frame", frame: "child" }];
    initial.frames!.child = { fields: [{ name: "word", type: "bytes", length: 2 }] };
    result.events[0].fields.data = { raw: "0102AB", value: { hex: "0102AB", length: 3 }, fields: {
      size: { raw: "01", value: 1, byteOffset: 0, byteLength: 1 }, child: { raw: "02AB", value: { hex: "02AB", length: 2 }, byteOffset: 1, byteLength: 2,
        fields: { word: { raw: "02AB", value: { hex: "02AB", length: 2 }, byteOffset: 1, byteLength: 2 } } }
    } };
    editor(result.events, initial);
    await userEvent.click(screen.getByRole("combobox", { name: "选择帧" }));
    await userEvent.click(screen.getByRole("option", { name: "child" }));
    expect(screen.getByLabelText("word 解码值")).toHaveTextContent("02AB");
    await userEvent.click(screen.getByRole("button", { name: "选择帧字段 word" }));
    expect(screen.getByRole("button", { name: "字节 0：02，字段 word" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "字节 1：AB，字段 word" })).toHaveAttribute("aria-pressed", "true");
  });

  it("decodes selected sample lines using the existing unsaved preview endpoint and round trips form edits through YAML", async () => {
    const repository = { parsePreview: vi.fn(async () => preview) }, sample = { ...mockSkillSample, fileName: "sample.log", content: "data=02 A0 B0 03 55", lineCount: 1 };
    function Harness() {
      const [yaml, setYaml] = useState(stringify(spec));
      return <DecodingSection skillId={sample.skillId} yaml={yaml} onChange={setYaml} disabled={false} repository={repository} sample={sample} selectedLine={1} />;
    }
    render(<Harness />);
    await waitFor(() => expect(screen.getByLabelText("payload 解码值")).toHaveTextContent("A0B0"));
    expect(repository.parsePreview).toHaveBeenCalledWith(sample.skillId, { parsing: spec, sampleText: sample.content, fileName: sample.fileName });
    fireEvent.change(screen.getByRole("textbox", { name: "帧字段 3 名称" }), { target: { value: "state" } });
    await userEvent.click(screen.getByRole("tab", { name: "代码视图" }));
    const yaml = screen.getByRole("textbox", { name: "代码视图 · YAML" });
    const result = parse((yaml as HTMLTextAreaElement).value);
    expect(result.frames.packet.fields[2].name).toBe("state");
    expect(parsingSpecSchema.safeParse(result).success).toBe(true);
    fireEvent.change(yaml, { target: { value: stringify(result) } });
    await userEvent.click(screen.getByRole("tab", { name: "表单" }));
    expect(screen.getByRole("textbox", { name: "帧字段 3 名称" })).toHaveValue("state");
  });

  it("retains all variable constructs and options when editing an unrelated field", () => {
    const initial = structuredClone(spec);
    initial.registers = { reg: { width: 8, fields: [] } };
    initial.frames!.child = { fields: [{ name: "v", type: "uint", length: 1 }] };
    initial.frames!.packet.fields.push({ name: "nested", type: "frame", frame: "child", length: 1 }, { name: "items", type: "repeat", frame: "child", count: "size", multiplier: 2 },
      { name: "choice", type: "switch", on: "size", cases: { "0x2": { register: "reg" } }, default: { frame: "child" } }, { name: "tags", type: "tlv", tagSize: 1, lengthSize: 2, endian: "little", cases: { "1": { frame: "child" } } });
    const onChange = vi.fn();
    render(<FrameEditor spec={initial} onChange={onChange} disabled={false} events={[]} pending={false} />);
    fireEvent.change(screen.getByRole("textbox", { name: "帧字段 1 名称" }), { target: { value: "length" } });
    expect(onChange.mock.calls[0][0].frames.packet.fields.slice(4)).toEqual(initial.frames!.packet.fields.slice(4));
    expect(screen.getByRole("textbox", { name: "帧字段 8 条件 JSON" })).toHaveValue('{"1":{"frame":"child"}}');
  });

  it("updates nested references and bindings on decoder rename", () => {
    const initial = structuredClone(spec);
    initial.frames!.child = { fields: [{ name: "choice", type: "switch", on: "size", cases: { "1": { frame: "packet" } }, default: { register: "reg" } }] };
    expect(renameFrameReferences(initial, "frame", "packet", "renamed").extractors[0].fields.data).toEqual({ type: "hex", decode: { frame: "renamed" } });
    expect(renameFrameReferences(initial, "frame", "packet", "renamed").frames!.child.fields[0]).toMatchObject({ cases: { "1": { frame: "renamed" } } });
    expect(renameFrameReferences(initial, "register", "reg", "newReg").frames!.child.fields[0]).toMatchObject({ default: { register: "newReg" } });
  });

  it("keeps read-only editing disabled and allows byte inspection", async () => {
    editor(preview.events, spec, true);
    expect(screen.getByRole("textbox", { name: "帧字段 1 名称" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "新增帧字段" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "字节 0：02，字段 size" }));
    expect(screen.getByRole("button", { name: "选择帧字段 size" })).toHaveAttribute("aria-pressed", "true");
  });
});
