import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NodeOperationHistoryPanel, type NodeOperationEvent } from "./NodeOperationHistoryPanel";

describe("NodeOperationHistoryPanel", () => {
  it("expands full operation evidence while keeping long output and paths out of the collapsed summary", () => {
    const stdout = "3600\n".repeat(100);
    const events: NodeOperationEvent[] = [
      {
        id: "evt-1",
        at: "2026-05-15T10:00:00.000Z",
        parameterName: "充电输入限流",
        parameterKey: "charger.input_current_limit_ma",
        accessMode: "RW",
        action: "write-readback",
        status: "回读一致",
        returncode: 0,
        stdout,
        stderr: "device warning",
        nodePath: "/sys/secret/path"
      }
    ];

    render(<NodeOperationHistoryPanel events={events} />);
    fireEvent.click(screen.getByRole("button", { name: /节点操作记录/ }));

    const list = screen.getByRole("list", { name: "节点操作事件列表" });
    expect(within(list).getByText(/充电输入限流/)).toBeInTheDocument();
    expect(within(list).getByText(/回读一致/)).toBeInTheDocument();
    const path = within(list).getByText("/sys/secret/path");
    expect(path).not.toBeVisible();
    const details = path.closest("details") as HTMLDetailsElement;
    fireEvent.click(within(list).getByText("查看完整结果"));
    expect(details.open).toBe(true);
    expect(path).toBeVisible();
    expect(within(details).getByLabelText("标准输出").textContent).toBe(stdout);
    expect(within(details).getByLabelText("错误输出")).toHaveTextContent("device warning");
    expect(within(details).getByText("操作时间")).toBeInTheDocument();
    expect(within(details).getByText("0")).toBeInTheDocument();
  });
});
