import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

function mockFetchSequence(responses: unknown[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn(async () => {
    const next = responses.shift();
    return new Response(JSON.stringify(next ?? { ok: true }));
  }) as typeof fetch);
}

function findRowByText(text: string) {
  const row = Array.from(screen.getByRole("table").querySelectorAll("tbody tr")).find((item) =>
    item.textContent?.includes(text)
  );
  if (!row) {
    throw new Error(`Cannot find row containing ${text}`);
  }
  return row as HTMLElement;
}

function currentValueCell(row: HTMLElement) {
  const cell = row.querySelector('[data-label="当前值"]');
  if (!cell) {
    throw new Error("Cannot find current value cell");
  }
  return cell as HTMLElement;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/node-debugging");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("/node-debugging", () => {
  it("auto-detects hdc targets on entry", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App />);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/hdc/targets"));
    expect(await screen.findByText(/已连接：target-a/)).toBeInTheDocument();
  });

  it("moves hdc connection controls into the topbar and removes the standalone page header", async () => {
    mockFetchSequence([{ ok: false, targets: [], stderr: "hdc target detection failed" }]);
    render(<App />);

    await screen.findByText("检测失败，请检查 HDC 环境");

    const topbarActions = document.querySelector(".topbar-page-actions") as HTMLElement | null;
    expect(topbarActions).toBeInTheDocument();
    await waitFor(() => expect(topbarActions).toHaveTextContent("未连接 HDC 设备"));
    expect(within(topbarActions as HTMLElement).getByRole("button", { name: "重新检测" })).toBeInTheDocument();
    expect(document.querySelector(".node-debugging-page > .page-header")).not.toBeInTheDocument();
  });

  it("does not show seeded values as current values before readable nodes are read", async () => {
    mockFetchSequence([{ ok: false, targets: [], stderr: "hdc target detection failed" }]);
    render(<App />);

    await screen.findByText("检测失败，请检查 HDC 环境");
    expect(document.querySelector(".disconnected-banner")).not.toBeInTheDocument();
    expect(screen.queryByText("hdc target detection failed")).not.toBeInTheDocument();

    const rwRow = findRowByText("charger.input_current_limit_ma");
    const roRow = findRowByText("battery.impedance_mohm");
    const woRow = findRowByText("charger.trickle_switch_soc");

    expect(currentValueCell(rwRow)).toHaveTextContent("等待读取");
    expect(currentValueCell(rwRow)).not.toHaveTextContent("3600");
    expect(currentValueCell(roRow)).toHaveTextContent("等待读取");
    expect(currentValueCell(roRow)).not.toHaveTextContent("68");
    expect(currentValueCell(woRow)).toHaveTextContent("写入后不可回读");
  });

  it("auto-reads readable nodes after hdc detection", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
      { ok: true, value: "3651", returncode: 0, stdout: "3651\n", stderr: "" },
      { ok: true, value: "41", returncode: 0, stdout: "41\n", stderr: "" },
      { ok: true, value: "1", returncode: 0, stdout: "1\n", stderr: "" },
      { ok: true, value: "69", returncode: 0, stdout: "69\n", stderr: "" },
      { ok: true, value: "80", returncode: 0, stdout: "80\n", stderr: "" },
      { ok: true, value: "46", returncode: 0, stdout: "46\n", stderr: "" },
      { ok: true, value: "5100", returncode: 0, stdout: "5100\n", stderr: "" }
    ]);
    render(<App />);

    await screen.findByText(/已连接：target-a/);
    const rwRow = await within(findRowByText("charger.input_current_limit_ma")).findByText("3651");
    expect(rwRow).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(fetch).toHaveBeenLastCalledWith("/api/hdc/read-node", expect.objectContaining({ method: "POST" }));
  });

  it("shows a node debug session summary and updates it after writes", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
      { ok: true, value: "3600", returncode: 0, stdout: "3600\n", stderr: "" },
      { ok: true, value: "43", returncode: 0, stdout: "43\n", stderr: "" },
      { ok: true, value: "1", returncode: 0, stdout: "1\n", stderr: "" },
      { ok: true, value: "68", returncode: 0, stdout: "68\n", stderr: "" },
      { ok: true, value: "84", returncode: 0, stdout: "84\n", stderr: "" },
      { ok: true, value: "46", returncode: 0, stdout: "46\n", stderr: "" },
      { ok: true, value: "5200", returncode: 0, stdout: "5200\n", stderr: "" },
      {
        ok: true,
        verified: true,
        value: "3700",
        writeResult: { returncode: 0, stdout: "", stderr: "" },
        readResult: { returncode: 0, stdout: "3700\n", stderr: "" }
      }
    ]);
    render(<App />);

    const summary = await screen.findByRole("region", { name: "调试会话摘要" });
    await within(summary).findByText(/在线 · target-a/);
    expect(summary).toHaveTextContent("会话时长");
    expect(summary).toHaveTextContent("已写入");
    expect(summary).toHaveTextContent("待写入");
    expect(summary).toHaveTextContent("失败");
    expect(summary).toHaveTextContent("1");

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));
    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    fireEvent.change(within(dialog).getByLabelText("目标写入值"), { target: { value: "3700" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /写入并回读/ }));

    await within(row).findByText(/^成功$/);
    expect(summary).toHaveTextContent("最近操作");
    expect(summary).toHaveTextContent("充电输入限流");
    expect(summary).toHaveTextContent("成功");
    expect(within(summary).getByText("已写入").nextElementSibling).toHaveTextContent("1");
  });

  it("uses a compact status set with distinct status classes", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
      { ok: true, value: "3651", returncode: 0, stdout: "3651\n", stderr: "" },
      { ok: true, value: "41", returncode: 0, stdout: "41\n", stderr: "" },
      { ok: true, value: "1", returncode: 0, stdout: "1\n", stderr: "" },
      { ok: true, value: "69", returncode: 0, stdout: "69\n", stderr: "" },
      { ok: true, value: "80", returncode: 0, stdout: "80\n", stderr: "" },
      { ok: true, value: "46", returncode: 0, stdout: "46\n", stderr: "" },
      { ok: true, value: "5100", returncode: 0, stdout: "5100\n", stderr: "" }
    ]);
    render(<App />);

    await within(findRowByText("charger.input_current_limit_ma")).findByText("成功");
    const successBadge = within(findRowByText("charger.input_current_limit_ma")).getByText("成功");
    const pendingBadge = within(findRowByText("charger.trickle_switch_soc")).getByText("待写入");

    expect(successBadge).toHaveClass("node-status-badge", "node-status-success");
    expect(pendingBadge).toHaveClass("node-status-badge", "node-status-pending");
    expect(screen.queryByText("读取成功")).not.toBeInTheDocument();
    expect(screen.queryByText("回读一致")).not.toBeInTheDocument();
    expect(screen.queryByText("回读不一致")).not.toBeInTheDocument();
  });

  it("does not expose node paths to normal users", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App />);

    await screen.findByText(/已连接：target-a/);
    expect(document.body).not.toHaveTextContent("/data/local/tmp/wiseeff_nodes");
  });

  it("omits risk filtering and the risk column", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App />);

    await screen.findByText(/已连接：target-a/);

    expect(screen.queryByRole("button", { name: /风险等级/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "风险" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /访问模式/ })).toBeInTheDocument();
  });

  it("uses a detail sheet for node operations instead of row-level read and write controls", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App />);
    await screen.findByText(/已连接：target-a/);

    const roRow = findRowByText("battery.impedance_mohm");
    const woRow = findRowByText("charger.trickle_switch_soc");
    const rwRow = findRowByText("charger.input_current_limit_ma");

    expect(screen.queryByRole("button", { name: /^读取$/ })).not.toBeInTheDocument();
    expect(within(rwRow).queryByLabelText(/目标写入值/)).not.toBeInTheDocument();
    expect(within(roRow).getByRole("button", { name: /查看详情/ })).toBeInTheDocument();
    expect(within(roRow).queryByRole("button", { name: /写入/ })).not.toBeInTheDocument();
    expect(within(woRow).getByRole("button", { name: /查看\/修改/ })).toBeInTheDocument();
    expect(within(rwRow).getByRole("button", { name: /查看\/修改/ })).toBeInTheDocument();
  });

  it("shows read-only node details without a write input", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
      { ok: true, value: "3600", returncode: 0, stdout: "3600\n", stderr: "" },
      { ok: true, value: "43", returncode: 0, stdout: "43\n", stderr: "" },
      { ok: true, value: "1", returncode: 0, stdout: "1\n", stderr: "" },
      { ok: true, value: "68", returncode: 0, stdout: "68\n", stderr: "" },
      { ok: true, value: "84", returncode: 0, stdout: "84\n", stderr: "" },
      { ok: true, value: "46", returncode: 0, stdout: "46\n", stderr: "" },
      { ok: true, value: "5200", returncode: 0, stdout: "5200\n", stderr: "" }
    ]);
    render(<App />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("battery.impedance_mohm");
    fireEvent.click(within(row).getByRole("button", { name: /查看详情/ }));

    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    expect(within(dialog).getByText("battery.impedance_mohm")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("68 mΩ");
    expect(within(dialog).queryByLabelText("目标写入值")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /写入/ })).not.toBeInTheDocument();
  });

  it("writes and verifies RW nodes from the detail sheet", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
      { ok: true, value: "3600", returncode: 0, stdout: "3600\n", stderr: "" },
      { ok: true, value: "43", returncode: 0, stdout: "43\n", stderr: "" },
      { ok: true, value: "1", returncode: 0, stdout: "1\n", stderr: "" },
      { ok: true, value: "68", returncode: 0, stdout: "68\n", stderr: "" },
      { ok: true, value: "84", returncode: 0, stdout: "84\n", stderr: "" },
      { ok: true, value: "46", returncode: 0, stdout: "46\n", stderr: "" },
      { ok: true, value: "5200", returncode: 0, stdout: "5200\n", stderr: "" },
      {
        ok: true,
        verified: true,
        value: "3700",
        writeResult: { returncode: 0, stdout: "", stderr: "" },
        readResult: { returncode: 0, stdout: "3700\n", stderr: "" }
      }
    ]);
    render(<App />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));

    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    fireEvent.change(within(dialog).getByLabelText("目标写入值"), { target: { value: "3700" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /写入并回读/ }));

    expect(screen.queryByRole("dialog", { name: /确认写入节点/ })).not.toBeInTheDocument();
    await within(row).findByText(/^成功$/);
    expect(currentValueCell(row)).toHaveTextContent("3700");
  });

  it("stashes detail edits and writes selected pending nodes in bulk", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
      { ok: true, value: "3600", returncode: 0, stdout: "3600\n", stderr: "" },
      { ok: true, value: "43", returncode: 0, stdout: "43\n", stderr: "" },
      { ok: true, value: "1", returncode: 0, stdout: "1\n", stderr: "" },
      { ok: true, value: "68", returncode: 0, stdout: "68\n", stderr: "" },
      { ok: true, value: "84", returncode: 0, stdout: "84\n", stderr: "" },
      { ok: true, value: "46", returncode: 0, stdout: "46\n", stderr: "" },
      { ok: true, value: "5200", returncode: 0, stdout: "5200\n", stderr: "" },
      {
        ok: true,
        verified: true,
        value: "3700",
        writeResult: { returncode: 0, stdout: "", stderr: "" },
        readResult: { returncode: 0, stdout: "3700\n", stderr: "" }
      }
    ]);
    render(<App />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));
    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    fireEvent.change(within(dialog).getByLabelText("目标写入值"), { target: { value: "3700" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "暂存" }));

    expect(screen.queryByRole("dialog", { name: /节点详情/ })).not.toBeInTheDocument();
    expect(within(row).getByText("3700")).toBeInTheDocument();
    expect(within(row).getByText("待写入")).toHaveClass("node-status-pending");
    expect(within(row).getByRole("checkbox", { name: /选择 充电输入限流/ })).toBeChecked();
    expect(screen.getByText("已选 1 项")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /下发选中 \(1\)/ }));

    await within(row).findByText(/^成功$/);
    expect(fetch).toHaveBeenLastCalledWith("/api/hdc/write-node", expect.objectContaining({ method: "POST" }));
  });

  it("shows write format as an independent detail section", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));

    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    const formatSection = within(dialog).getByRole("region", { name: "写入格式" });

    expect(formatSection).toHaveTextContent("写入格式");
    expect(formatSection).toHaveTextContent("示例");
    expect(formatSection).toHaveTextContent("3600");
    expect(formatSection).toHaveTextContent("RW");
    expect(formatSection).toHaveTextContent("2000 - 5000 mA");
    expect(formatSection).not.toHaveTextContent("/data/local/tmp/wiseeff_nodes");
  });

  it("places the target value input after the write format section", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));

    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    const formatSection = within(dialog).getByRole("region", { name: "写入格式" });
    const targetInput = within(dialog).getByLabelText("目标写入值");

    expect(formatSection.compareDocumentPosition(targetInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps write format examples stable while editing the target value", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));

    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    const formatSection = within(dialog).getByRole("region", { name: "写入格式" });

    expect(formatSection).toHaveTextContent("例如输入 3600");
    fireEvent.change(within(dialog).getByLabelText("目标写入值"), { target: { value: "3700" } });

    expect(formatSection).toHaveTextContent("例如输入 3600");
    expect(formatSection).not.toHaveTextContent("3700");
  });

  it("uses a multiline target value editor for complex writes", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));

    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    const targetEditor = within(dialog).getByLabelText("目标写入值");
    const multilineValue = "limit=3700\nenable=1";

    expect(targetEditor.tagName).toBe("TEXTAREA");
    fireEvent.change(targetEditor, { target: { value: multilineValue } });
    expect(targetEditor).toHaveValue(multilineValue);
  });

  it("marks RW readback mismatch", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
      { ok: true, value: "3600", returncode: 0, stdout: "3600\n", stderr: "" },
      { ok: true, value: "43", returncode: 0, stdout: "43\n", stderr: "" },
      { ok: true, value: "1", returncode: 0, stdout: "1\n", stderr: "" },
      { ok: true, value: "68", returncode: 0, stdout: "68\n", stderr: "" },
      { ok: true, value: "84", returncode: 0, stdout: "84\n", stderr: "" },
      { ok: true, value: "46", returncode: 0, stdout: "46\n", stderr: "" },
      { ok: true, value: "5200", returncode: 0, stdout: "5200\n", stderr: "" },
      {
        ok: true,
        verified: false,
        value: "3600",
        writeResult: { returncode: 0, stdout: "", stderr: "" },
        readResult: { returncode: 0, stdout: "3600\n", stderr: "" }
      }
    ]);
    render(<App />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));
    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    fireEvent.change(within(dialog).getByLabelText("目标写入值"), { target: { value: "3700" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /写入并回读/ }));

    await within(row).findByText(/^失败$/);
  });
});
