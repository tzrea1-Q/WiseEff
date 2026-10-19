import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StructuredValueEditor, type StructuredValueEditorProps } from "./StructuredValueEditor";

function ControlledEditor(props: StructuredValueEditorProps) {
  const [draft, setDraft] = useState({ rawText: props.rawText, present: props.present, editorState: props.editorState });
  return <StructuredValueEditor {...props} {...draft} onChange={(next) => {
    setDraft({ rawText: next.rawText, present: next.present, editorState: next.editorState });
    props.onChange(next);
  }} />;
}

describe("DTS raw value editing", () => {
  it.each([
    { valueType: "string-list" as const, propertyName: "names", rawText: '"a,b", "", "a,b"' },
    { valueType: "u32-array" as const, propertyName: "reg", rawText: "<1 2>, <3 4>" },
    { valueType: "bytes" as const, propertyName: "data", rawText: "[00 ff 7f]" },
    { valueType: "bytes" as const, propertyName: "count", rawText: "/bits/ 64 <9007199254740993>" },
    { valueType: "phandle-list" as const, propertyName: "clocks", rawText: "<&clock &clock>" },
    { valueType: "mixed" as const, propertyName: "mixed", rawText: '"alpha", <&clock 1 2>' },
    { valueType: "bool" as const, propertyName: "enabled", rawText: "" },
    { valueType: "empty" as const, propertyName: "ranges", rawText: "" }
  ])("uses one raw textarea for $propertyName without type controls", (props) => {
    render(<StructuredValueEditor {...props} onChange={vi.fn()} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "DTS 原文" })).toHaveValue(props.rawText);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("preserves formatting, group boundaries and exact 64-bit values", () => {
    const onChange = vi.fn();
    render(<ControlledEditor propertyName="count" valueType="u32-array" rawText="<1>" onChange={onChange} />);
    const rawText = " /bits/ 64 <9007199254740993>,\n/bits/ 64 <18446744073709551615> ";
    fireEvent.change(screen.getByRole("textbox"), { target: { value: rawText } });
    expect(screen.getByRole("textbox")).toHaveValue(rawText);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ rawText, valid: true, present: true }));
  });

  it("keeps invalid text and exposes its syntax error on blur", () => {
    const onChange = vi.fn();
    render(<ControlledEditor propertyName="reg" valueType="u32-array" rawText="<1>" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "<1 0x" } });
    expect(screen.getByRole("textbox")).toHaveValue("<1 0x");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ rawText: "<1 0x", valid: false }));
    fireEvent.blur(screen.getByRole("textbox"));
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("textbox")).toHaveAccessibleDescription(/DTS 取值无效/);
  });

  it("checks pinned constraints, supports deletion and restores the property with raw input", () => {
    const onChange = vi.fn();
    render(<ControlledEditor propertyName="reg" valueType="u32-array" rawText="<4>"
      valueSchema={{ type: "integer", maximum: 8 }} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "<9>" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ valid: false, error: "取值不能大于 8" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "/delete-property/" } });
    expect(screen.getByRole("textbox")).toHaveValue("/delete-property/");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ rawText: "", valid: true, present: false }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "<7>" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ rawText: "<7>", valid: true, present: true }));
  });

  it("keeps a blank boolean present and allows empty properties to be edited", () => {
    const onChange = vi.fn();
    const { rerender } = render(<StructuredValueEditor propertyName="enabled" valueType="bool" rawText="" present={false} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ rawText: "", present: true, valid: true }));
    rerender(<StructuredValueEditor propertyName="ranges" valueType="empty" rawText="" onChange={onChange} />);
    expect(screen.getByRole("textbox")).toBeEnabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "<1 2>" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ rawText: "<1 2>", valid: true }));
  });

  it("retains legacy unconfirmed input until it is explicitly edited", () => {
    const onChange = vi.fn();
    render(<ControlledEditor propertyName="names" valueType="string-list" rawText='"old"' showErrors
      editorState={{ kind: "string-input", format: "lines", text: 'a,b\n\n quote" ' }} onChange={onChange} />);
    expect(screen.getByRole("textbox")).toHaveValue('"a,b", "", " quote\\" "');
    expect(screen.getByRole("textbox")).toHaveAccessibleDescription(/已恢复旧版未确认输入/);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: '"confirmed"' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ rawText: '"confirmed"', valid: true }));
    expect(onChange.mock.calls.at(-1)?.[0].editorState).toBeUndefined();
  });

  it("retains legacy numeric bulk text without discarding unfinished content", () => {
    render(<StructuredValueEditor propertyName="reg" valueType="u32-array" rawText="<1>" showErrors onChange={vi.fn()}
      editorState={{ kind: "numeric-input", format: "table", text: "1\t\n0x", source: { kind: "cells", bits: 32, groups: [["1"]] } }} />);
    expect(screen.getByRole("textbox")).toHaveValue("1\t\n0x");
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("honors permission locks and external undo", () => {
    const onChange = vi.fn();
    const { rerender } = render(<StructuredValueEditor propertyName="names" valueType="string-list" rawText='"old"' disabled onChange={onChange} />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    rerender(<StructuredValueEditor propertyName="names" valueType="string-list" rawText='"undo"' onChange={onChange} />);
    expect(screen.getByRole("textbox")).toHaveValue('"undo"');
  });
});
