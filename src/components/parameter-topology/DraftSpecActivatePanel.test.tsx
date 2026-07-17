import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";

import { DraftSpecActivatePanel } from "./DraftSpecActivatePanel";
import type { ParameterSpecDetailView } from "./ParameterSpecDetail";

afterEach(() => cleanup());

function draftDetail(overrides: Partial<ParameterSpecDetailView> = {}): ParameterSpecDetailView {
  return {
    id: "spec-gpio",
    organizationId: "org-chargelab",
    propertyKey: "gpio_int",
    driverModule: "sc8562",
    compatible: "vendor,sc8562",
    valueType: "cells",
    valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 3 },
    schemaSource: "manual",
    schemaVersion: 1,
    exampleValue: "<&gpio13 29 0>",
    businessCategory: null,
    reviewState: "draft",
    usageCount: 0,
    ...overrides,
  };
}

describe("DraftSpecActivatePanel", () => {
  it("prefills cells constraint from inferred cellsPerGroup for gpio_int", () => {
    render(<DraftSpecActivatePanel detail={draftDetail()} onActivate={() => undefined} />);
    expect(screen.getByLabelText("推断值形状摘要").textContent).toContain("cellsPerGroup=3");
    expect((screen.getByLabelText("单元格数量约束") as HTMLInputElement).value).toBe("3");
  });

  it("submits full inferred valueShape on activate (gpio_int three-cell)", () => {
    const onActivate = vi.fn();
    render(<DraftSpecActivatePanel detail={draftDetail()} onActivate={onActivate} />);
    fireEvent.change(screen.getByLabelText("规格说明"), {
      target: { value: "GPIO interrupt cells for sc8562" },
    });
    fireEvent.change(screen.getByLabelText("激活原因"), {
      target: { value: "Inferred three-cell phandle group from occurrence" },
    });
    fireEvent.click(screen.getByRole("button", { name: "激活规格" }));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0]?.[0]).toMatchObject({
      valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 3 },
      constraints: expect.objectContaining({ cells: 3 }),
    });
  });

  it("blocks activation when valueShape is missing", () => {
    render(
      <DraftSpecActivatePanel
        detail={draftDetail({ valueShape: null, valueType: "cells" })}
        onActivate={() => undefined}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/缺少完整 valueShape/);
    expect(screen.getByRole("button", { name: "激活规格" })).toBeDisabled();
  });

  it("blocks activation when inferred cell grouping is incomplete", () => {
    render(
      <DraftSpecActivatePanel
        detail={draftDetail({ valueShape: { kind: "cells", cellsPerGroup: 3 } })}
        onActivate={() => undefined}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/bits.*groups/i);
    expect(screen.getByRole("button", { name: "激活规格" })).toBeDisabled();
  });

  it("blocks activation when inferred byte length is missing", () => {
    render(
      <DraftSpecActivatePanel
        detail={draftDetail({ valueType: "bytes", valueShape: { kind: "bytes" } })}
        onActivate={() => undefined}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/length/i);
    expect(screen.getByRole("button", { name: "激活规格" })).toBeDisabled();
  });

  it("resets inferred cells and operator input when the selected draft changes", () => {
    const { rerender } = render(
      <DraftSpecActivatePanel detail={draftDetail()} onActivate={() => undefined} />,
    );
    fireEvent.change(screen.getByLabelText("单元格数量约束"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("规格说明"), { target: { value: "previous docs" } });
    fireEvent.change(screen.getByLabelText("激活原因"), { target: { value: "previous reason" } });

    rerender(
      <DraftSpecActivatePanel
        detail={draftDetail({
          id: "spec-next",
          propertyKey: "interrupt-count",
          valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 },
        })}
        onActivate={() => undefined}
      />,
    );

    expect((screen.getByLabelText("单元格数量约束") as HTMLInputElement).value).toBe("1");
    expect((screen.getByLabelText("规格说明") as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByLabelText("激活原因") as HTMLTextAreaElement).value).toBe("");
  });

  it("rejects a fractional cell constraint", () => {
    render(<DraftSpecActivatePanel detail={draftDetail()} onActivate={() => undefined} />);
    fireEvent.change(screen.getByLabelText("单元格数量约束"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("规格说明"), { target: { value: "docs" } });
    fireEvent.change(screen.getByLabelText("激活原因"), { target: { value: "reason" } });

    expect(screen.getByRole("button", { name: "激活规格" })).toBeDisabled();
  });
});
