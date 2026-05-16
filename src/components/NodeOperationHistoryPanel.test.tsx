import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NodeOperationHistoryPanel, type NodeOperationEvent } from "./NodeOperationHistoryPanel";

describe("NodeOperationHistoryPanel", () => {
  it("shows node operation evidence without node paths", () => {
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
        stdout: "3600\n",
        stderr: "",
        nodePath: "/sys/secret/path"
      }
    ];

    render(<NodeOperationHistoryPanel events={events} />);
    fireEvent.click(screen.getByRole("button", { name: /节点操作记录/ }));

    const list = screen.getByRole("list", { name: "节点操作事件列表" });
    expect(within(list).getByText(/充电输入限流/)).toBeInTheDocument();
    expect(within(list).getByText(/回读一致/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("/sys/secret/path");
  });
});
