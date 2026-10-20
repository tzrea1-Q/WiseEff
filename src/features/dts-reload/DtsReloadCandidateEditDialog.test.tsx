import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DtsReloadCandidate } from "@/domain/dtsReload/types";
import { DtsReloadCandidateEditDialog } from "./DtsReloadCandidateEditDialog";

const candidate: DtsReloadCandidate = {
  bindingId: "binding-1", projectId: "project-1", propertyKey: "fcp_support", displayName: "FCP 支持",
  module: "充电", nodePath: "/charger", baselineValue: "<0>", description: "是否启用 FCP 充电协议。",
  valueShapeKind: "u32-array", resolvedValueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
  unit: null, constraints: { min: 0, max: 1, cells: 1 }, debuggable: true
};

describe("DtsReloadCandidateEditDialog", () => {
  it("preserves the full multiline syntax reference and previous reload value", () => {
    const value = `<${"12345678 ".repeat(40)}>\n<123 456>\n<789 012>`;
    render(<DtsReloadCandidateEditDialog candidate={{ ...candidate, baselineValue: value, lastReload: { runId: "run-1", debugValue: value, attemptedAt: "2026-10-19T00:00:00.000Z", outcome: "verified", purpose: "ordinary" } }} initialDebugValue={value} alreadyInBatch={false} onClose={vi.fn()} onDirtyChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole("region", { name: "语法参照" }).textContent).toBe(value);
    const previousValue = screen.getByLabelText("上次重载调试值");
    expect(previousValue.textContent).toBe(value);
    expect(previousValue.tagName).toBe("PRE");
    expect(previousValue).toHaveAttribute("tabindex", "0");
  });

  it("presents meaning and constraints before editing and validates input inline", async () => {
    const onConfirm = vi.fn(() => null);
    render(<DtsReloadCandidateEditDialog candidate={candidate} initialDebugValue="<0>" alreadyInBatch={false} onClose={vi.fn()} onDirtyChange={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByText(candidate.description!)).toBeVisible();
    expect(screen.getByText(/范围 0 – 1/)).toBeVisible();
    expect(screen.getByText(/仅供格式参考，不是业务取值建议/)).toBeVisible();
    expect(screen.getByLabelText("FCP 支持 调试值")).toHaveAttribute("placeholder", "<0>");
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("FCP 支持 调试值"));
    await user.paste("<2>");
    expect(screen.getByRole("alert")).toHaveTextContent("超过声明的最大值 1");
    await user.click(screen.getByRole("button", { name: "加入本轮重载" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("allows blocked candidate details to be read without any write action", () => {
    render(<DtsReloadCandidateEditDialog candidate={{ ...candidate, debuggable: false, blockReason: "no-node-path" }} initialDebugValue="<0>" alreadyInBatch={false} onClose={vi.fn()} onDirtyChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByLabelText("FCP 支持 调试值")).toHaveAttribute("readonly");
    expect(screen.getByText(/缺少绝对节点路径/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "加入本轮重载" })).not.toBeInTheDocument();
  });
});
