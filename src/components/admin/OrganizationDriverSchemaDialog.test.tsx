import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrganizationDriverSchemaDialog } from "./OrganizationDriverSchemaDialog";

afterEach(() => cleanup());

describe("OrganizationDriverSchemaDialog", () => {
  it("submits linked parameterSpecIds and opens the picker via onAddProperty", async () => {
    const onAddProperty = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <OrganizationDriverSchemaDialog
        compatible="vendor,orphan"
        linkedSpecs={[
          {
            kind: "link",
            parameterSpecId: "pspec-1",
            propertyKey: "enable-gpios",
            driverModule: "orphan"
          }
        ]}
        onCancel={vi.fn()}
        onAddProperty={onAddProperty}
        onRemoveProperty={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "配置组织级解析" });
    fireEvent.change(within(dialog).getByLabelText("显示名称"), {
      target: { value: "Orphan Driver" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加参数定义" }));
    expect(onAddProperty).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole("button", { name: "保存并激活" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        compatible: "vendor,orphan",
        displayName: "Orphan Driver",
        properties: [{ parameterSpecId: "pspec-1" }]
      });
    });
  });

  it("submits pending create properties collected from the picker stack", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <OrganizationDriverSchemaDialog
        compatible="vendor,orphan"
        linkedSpecs={[
          {
            kind: "create",
            propertyKey: "vout_ovp_mv",
            valueShape: { kind: "u32-array" },
            units: "mV"
          }
        ]}
        onCancel={vi.fn()}
        onAddProperty={vi.fn()}
        onRemoveProperty={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "配置组织级解析" });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存并激活" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        compatible: "vendor,orphan",
        displayName: "vendor,orphan",
        properties: [
          {
            propertyKey: "vout_ovp_mv",
            valueShape: { kind: "u32-array" },
            units: "mV"
          }
        ]
      });
    });
  });
});
