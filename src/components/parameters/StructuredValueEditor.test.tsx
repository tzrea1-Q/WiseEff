import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  StructuredValueEditor,
  type StructuredValueChange,
  type StructuredValueEditorProps,
} from "./StructuredValueEditor";

function ControlledEditor({
  onChange,
  rawText: initialRaw,
  ...rest
}: StructuredValueEditorProps) {
  const [rawText, setRawText] = useState(initialRaw);
  return (
    <StructuredValueEditor
      {...rest}
      rawText={rawText}
      onChange={(next: StructuredValueChange) => {
        setRawText(next.rawText);
        onChange(next);
      }}
    />
  );
}

describe("StructuredValueEditor", () => {
  it("renders a multi-cell matrix for u32-array and emits normalized rawText", () => {
    const onChange = vi.fn();
    render(
      <ControlledEditor
        propertyName="reg"
        valueType="u32-array"
        rawText="<0xB 0x4b>"
        onChange={onChange}
      />
    );

    const cells = screen.getAllByRole("textbox", { name: /cell/i });
    expect(cells.length).toBeGreaterThanOrEqual(2);
    expect(cells[0]).toHaveValue("0xB");
    expect(cells[1]).toHaveValue("0x4b");

    fireEvent.change(cells[0], { target: { value: "0xb" } });
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last).toMatchObject({
      rawText: "<0xb 0x4b>",
      valueType: "u32-array",
      normalizedValue: "<0xb 0x4b>",
      valid: true,
    });
  });

  it("marks illegal u32 cell input invalid with aria-invalid and field-error", () => {
    const onChange = vi.fn();
    render(
      <ControlledEditor
        propertyName="reg"
        valueType="u32-array"
        rawText="<0x1>"
        onChange={onChange}
        showErrors
      />
    );

    const cell = screen.getByRole("textbox", { name: /cell 1/i });
    fireEvent.change(cell, { target: { value: "0xGG" } });

    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.valid).toBe(false);
    expect(last.error).toBeTruthy();
    expect(cell).toHaveAttribute("aria-invalid", "true");
    expect(document.querySelector(".field-error")).toBeTruthy();
  });

  it("renders bytes width + byte cells and builds /bits/ rawText", () => {
    const onChange = vi.fn();
    render(
      <ControlledEditor
        propertyName="reg_config"
        valueType="bytes"
        rawText="/bits/ 8 <0x19 0x01>"
        onChange={onChange}
      />
    );

    expect(screen.getByLabelText(/bits width|位宽/i)).toHaveValue(8);
    const bytes = screen.getAllByRole("textbox", { name: /byte/i });
    expect(bytes).toHaveLength(2);

    fireEvent.change(bytes[1], { target: { value: "0xAB" } });
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.rawText).toBe("/bits/ 8 <0x19 0xAB>");
    expect(last.normalizedValue).toBe("/bits/ 8 <0x19 0xab>");
    expect(last.valid).toBe(true);
  });

  it("renders string-list rows with add/remove and emits quoted list", () => {
    const onChange = vi.fn();
    render(
      <ControlledEditor
        propertyName="compatible"
        valueType="string-list"
        rawText='"a", "b"'
        onChange={onChange}
      />
    );

    expect(screen.getByDisplayValue("a")).toBeInTheDocument();
    expect(screen.getByDisplayValue("b")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /添加字符串|add string/i }));
    const lastAdd = onChange.mock.calls.at(-1)?.[0];
    expect(lastAdd.rawText).toBe('"a", "b", ""');

    fireEvent.click(screen.getByRole("button", { name: /移除字符串 2|remove string 2/i }));
    const lastRemove = onChange.mock.calls.at(-1)?.[0];
    expect(lastRemove.rawText).toBe('"a", ""');
  });

  it("renders phandle-list label multi-select and emits &label cells", () => {
    const onChange = vi.fn();
    render(
      <ControlledEditor
        propertyName="interrupt-parent"
        valueType="phandle-list"
        rawText="<&a>"
        availableLabels={["a", "b", "gpio"]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "b" }));
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.rawText).toBe("<&a &b>");
    expect(last.valueType).toBe("phandle-list");
    expect(last.normalizedValue).toBe("<&a &b>");
    expect(last.valid).toBe(true);
  });

  it("renders bool as a switch with empty rawText semantics", () => {
    const onChange = vi.fn();
    render(
      <ControlledEditor
        propertyName="weak_source_sleep_enabled"
        valueType="bool"
        rawText=""
        onChange={onChange}
      />
    );

    const toggle = screen.getByRole("checkbox", { name: /布尔|bool|开关/i });
    expect(toggle).toBeChecked();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
      rawText: "",
      valueType: "bool",
      valid: false,
    });

    fireEvent.click(screen.getByRole("checkbox", { name: /布尔|bool|开关/i }));
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
      rawText: "",
      valueType: "bool",
      normalizedValue: "true",
      valid: true,
    });
  });

  it("renders empty as a readonly note without editable controls", () => {
    const onChange = vi.fn();
    render(
      <StructuredValueEditor
        propertyName="ranges"
        valueType="empty"
        rawText=""
        onChange={onChange}
      />
    );

    expect(screen.getByText(/空属性（只读）/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders mixed as a code textarea with parameter-admin-code-editor class", () => {
    const onChange = vi.fn();
    render(
      <ControlledEditor
        propertyName="gpio_int"
        valueType="mixed"
        rawText="<&gpio 29 0>"
        onChange={onChange}
      />
    );

    const editor = screen.getByRole("textbox", { name: /值|mixed|raw/i });
    expect(editor).toHaveClass("parameter-admin-code-editor");
    expect(editor).toHaveValue("<&gpio 29 0>");

    fireEvent.change(editor, { target: { value: "<1 2>,<3 4>" } });
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last).toMatchObject({
      rawText: "<1 2>,<3 4>",
      valueType: "mixed",
      normalizedValue: "<1 2 3 4>",
      valid: true,
    });
  });

  it("shows normalizedValue preview aligned with client typing", () => {
    render(
      <StructuredValueEditor
        propertyName="reg"
        valueType="u32-array"
        rawText="<0xB 0x4B>"
        onChange={vi.fn()}
      />
    );

    const preview = screen.getByLabelText(/normalized|规范化|预览/i);
    expect(preview).toHaveTextContent("<0xb 0x4b>");
  });
});
