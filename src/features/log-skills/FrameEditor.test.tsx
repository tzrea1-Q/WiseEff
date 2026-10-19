import { useState } from "react";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parsingSpecSchema } from "@wiseeff/dto-schemas";
import { DecodingSection } from "./DecodingSection";
import { FrameEditor, frameOffsets, renameFrameReferences } from "./FrameEditor";
import { mockSkillSample } from "@/infrastructure/mock/logSkills";
import type { ParsePreview, SkillSpec } from "./types";

afterEach(cleanup);
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

function editor(events = preview.events, initial = spec, disabled = false) {
  function Harness() {
    const [value, setValue] = useState(initial);
    return <FrameEditor spec={value} onChange={setValue} disabled={disabled} events={events} selectedLine={1} pending={false} />;
  }
  return render(<Harness />);
}

describe("frame workspace", () => {
  it("computes fixed and relative offsets, including nested frames and constant repeats", () => {
    expect(frameOffsets(spec.frames!.packet, spec.frames!)).toEqual([{ offset: "0", length: 1 }, { offset: "1", length: undefined }, { offset: "+0 after payload", length: 1 }, { offset: "+1 after payload", length: 1 }]);
    const frames = { word: { fields: [{ name: "word", type: "uint" as const, length: 2 as const }] } };
    expect(frameOffsets({ fields: [{ name: "words", type: "repeat", frame: "word", count: 3, multiplier: 2 }, { name: "end", type: "uint", length: 1 }] }, frames))
      .toEqual([{ offset: "0", length: 12 }, { offset: "12", length: 1 }]);
    expect(frameOffsets({ fields: [{ name: "child", type: "frame", frame: "word", length: "size" }, { name: "end", type: "uint", length: 1 }] }, frames))
      .toEqual([{ offset: "0", length: undefined }, { offset: "+0 after child", length: 1 }]);
  });

  it("links field selection to bytes and byte selection to the field with text and pressed states", async () => {
    editor();
    await userEvent.click(screen.getByRole("button", { name: "选择帧字段 payload" }));
    expect(screen.getByText("已选字段：payload（▶ 与边框标记字节）")).toBeVisible();
    const hex = screen.getByRole("group", { name: "帧十六进制视图" });
    expect(within(hex).getAllByRole("button", { pressed: true }).map((byte) => byte.getAttribute("aria-label"))).toEqual(["字节 1：A0，字段 payload", "字节 2：B0，字段 payload"]);
    expect(within(hex).getByRole("button", { name: "字节 1：A0，字段 payload" })).toHaveTextContent("▶A0");
    await userEvent.click(within(hex).getByRole("button", { name: "字节 3：03，字段 status" }));
    expect(screen.getByRole("button", { name: "选择帧字段 status" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "选择帧字段 payload" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("status 解码值")).toHaveTextContent("3");
    expect(screen.getByText("+1 after payload")).toBeVisible();
    expect(screen.getByRole("status", { name: "sum 校验状态" })).toHaveTextContent("✓ 校验通过 · 期望 85 / 实际 85");
  });

  it("shows a failing checksum inline and renders 16 bytes per hex row", () => {
    const result = structuredClone(preview);
    const data = result.events[0].fields.data;
    if (!data || typeof data !== "object" || !("fields" in data) || !data.fields) throw new Error("Missing frame fixture");
    data.raw = "00".repeat(17);
    data.value = { hex: "00".repeat(17), length: 17 };
    const sum = data.fields.sum;
    if (sum && typeof sum === "object" && "checksum" in sum) sum.checksum = { expected: 85, actual: 0, ok: false };
    const { container } = editor(result.events);
    expect(screen.getByRole("status", { name: "sum 校验状态" })).toHaveTextContent("✕ 校验失败 · 期望 85 / 实际 0");
    expect([...container.querySelectorAll(".skill-frame-hex-row")].map((row) => row.querySelectorAll("button").length)).toEqual([16, 1]);
    expect(screen.getByText("0010")).toBeVisible();
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
