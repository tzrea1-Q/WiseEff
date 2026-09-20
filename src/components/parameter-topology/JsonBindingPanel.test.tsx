import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectParameterBinding } from "@/domain/parameter-topology/types";
import { JsonBindingPanel } from "./JsonBindingPanel";

const jsonBinding: ProjectParameterBinding = {
  id: "binding-json-1",
  parameterSpecId: "spec-json-1",
  parameterSpecVersionId: "spec-json-v1",
  propertyKey: "charging-policy",
  driverModule: "charging",
  logicalNodeId: "node-1",
  instanceName: "charger0",
  locator: "/charger0",
  effectiveValue: { kind: "json", value: { kind: "cells", values: [1, 2] } },
  rawValue: '{"kind":"cells","values":[1,2]}',
  schemaState: "valid",
  policyState: "pass",
  moduleId: "module-charging"
};

describe("JsonBindingPanel", () => {
  it("keeps JSON source text out of the DTS parser and exposes exact export/history actions", async () => {
    const onValidateEdit = vi.fn().mockResolvedValue({ valid: true, diagnostics: [] });
    const onExportBinding = vi.fn().mockResolvedValue(undefined);
    const onLoadHistory = vi.fn().mockResolvedValue([
      {
        id: "history-1",
        reason: "校准充电策略",
        createdAt: "2026-09-17T01:02:03.000Z",
        oldCurrentValueId: "value-old",
        newCurrentValueId: "value-new"
      }
    ]);

    render(
      <JsonBindingPanel
        bindings={[jsonBinding]}
        canEdit
        onValidateEdit={onValidateEdit}
        onExportBinding={onExportBinding}
        onLoadHistory={onLoadHistory}
      />
    );

    const panel = screen.getByRole("region", { name: "JSON 参数" });
    expect(within(panel).getAllByText("{\"kind\":\"cells\",\"values\":[1,2]}").length).toBeGreaterThan(0);
    fireEvent.change(within(panel).getByLabelText("目标值"), {
      target: { value: '{"kind":"cells","values":[4,5]}' }
    });
    fireEvent.change(within(panel).getByLabelText("修改原因"), {
      target: { value: "校准充电策略" }
    });
    fireEvent.click(within(panel).getByRole("button", { name: "校验并创建草稿" }));
    await waitFor(() => {
      expect(onValidateEdit).toHaveBeenCalledWith({
        bindingId: "binding-json-1",
        rawValue: '{"kind":"cells","values":[4,5]}',
        reason: "校准充电策略"
      });
    });

    fireEvent.click(within(panel).getByRole("button", { name: "导出源文件" }));
    await waitFor(() => expect(onExportBinding).toHaveBeenCalledWith("binding-json-1"));
    fireEvent.click(within(panel).getByRole("button", { name: "查看固定值历史" }));
    await waitFor(() => expect(onLoadHistory).toHaveBeenCalledWith("binding-json-1"));
    expect(await within(panel).findByText("校准充电策略")).toBeVisible();
  });

  it("does not render DTS bindings in the JSON surface", () => {
    const dtsBinding = { ...jsonBinding, id: "binding-dts", effectiveValue: { kind: "empty", present: true } as const };
    const { container } = render(<JsonBindingPanel bindings={[dtsBinding]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows localized source errors linked to the JSON value input", async () => {
    render(<JsonBindingPanel bindings={[jsonBinding]} canEdit onValidateEdit={async () => ({
      valid: false,diagnostics: [{ code: "VALIDATION_FAILED",message: "JSON draft target is invalid or unsupported." }],
    })} />);
    fireEvent.change(screen.getByLabelText("目标值"),{ target: { value: "not-json" } });
    fireEvent.change(screen.getByLabelText("修改原因"),{ target: { value: "校验错误提示" } });
    fireEvent.click(screen.getByRole("button",{ name: "校验并创建草稿" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("目标值未通过校验");
    expect(alert).not.toHaveTextContent("JSON draft target");
    expect(screen.getByLabelText("目标值")).toHaveAttribute("aria-describedby",alert.id);
    expect(screen.getByLabelText("目标值")).toHaveAttribute("aria-invalid","true");
  });
});
