import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OverlaySpecPickerDialog } from "./OverlaySpecPickerDialog";
import type { ParameterSpecLibraryRow } from "@/components/parameter-topology/ParameterSpecLibrary";

afterEach(() => cleanup());

const SPECS: ParameterSpecLibraryRow[] = [
  {
    id: "pspec-1",
    organizationId: "org-1",
    propertyKey: "enable-gpios",
    attributionModules: [],
    driverModule: "orphan",
    compatible: "vendor,orphan",
    valueType: "unknown",
    valueShape: { kind: "unknown" },
    schemaSource: "manual",
    schemaVersion: 1,
    exampleValue: null,
    businessCategory: null,
    reviewState: "active",
    usageCount: 0
  },
  {
    id: "pspec-2",
    organizationId: "org-1",
    propertyKey: "battery_tbl",
    attributionModules: [],
    driverModule: "battery_cccv",
    compatible: null,
    valueType: "u32-array",
    valueShape: { kind: "u32-array" },
    schemaSource: "manual",
    schemaVersion: 1,
    exampleValue: null,
    businessCategory: null,
    reviewState: "active",
    usageCount: 0
  }
];

describe("OverlaySpecPickerDialog", () => {
  it("confirms a selected library row", async () => {
    const onConfirm = vi.fn();
    const onBack = vi.fn();

    render(
      <OverlaySpecPickerDialog specs={SPECS} onBack={onBack} onConfirm={onConfirm} />
    );

    const dialog = screen.getByRole("dialog", { name: "选择参数定义" });
    fireEvent.click(within(dialog).getByRole("button", { name: /选用 enable-gpios/i }));
    expect(within(dialog).getByRole("button", { name: "使用所选" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "使用所选" }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith({
        kind: "link",
        parameterSpecId: "pspec-1",
        propertyKey: "enable-gpios",
        driverModule: "orphan"
      });
    });
  });

  it("selects a row by clicking the table row", async () => {
    const onConfirm = vi.fn();

    render(
      <OverlaySpecPickerDialog specs={SPECS} onBack={vi.fn()} onConfirm={onConfirm} />
    );

    const dialog = screen.getByRole("dialog", { name: "选择参数定义" });
    const row = within(dialog).getByRole("row", { name: /enable-gpios/i });
    fireEvent.click(row);
    expect(within(dialog).getByRole("button", { name: "使用所选" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "使用所选" }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ parameterSpecId: "pspec-1" })
      );
    });
  });

  it("opens create form and returns a pending create payload", async () => {
    const onConfirm = vi.fn();

    render(
      <OverlaySpecPickerDialog specs={SPECS} onBack={vi.fn()} onConfirm={onConfirm} />
    );

    const picker = screen.getByRole("dialog", { name: "选择参数定义" });
    fireEvent.click(within(picker).getByRole("button", { name: "新建定义" }));

    const create = screen.getByRole("dialog", { name: "新建参数定义" });
    fireEvent.change(within(create).getByLabelText("属性键"), {
      target: { value: "vout_ovp_mv" }
    });
    fireEvent.change(within(create).getByLabelText("值类型"), {
      target: { value: "u32-array" }
    });
    fireEvent.click(within(create).getByRole("button", { name: "创建并选用" }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith({
        kind: "create",
        propertyKey: "vout_ovp_mv",
        valueShape: { kind: "u32-array" }
      });
    });
  });

  it("Escape closes the picker without confirming", () => {
    const onBack = vi.fn();
    const onConfirm = vi.fn();

    render(
      <OverlaySpecPickerDialog specs={SPECS} onBack={onBack} onConfirm={onConfirm} />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
