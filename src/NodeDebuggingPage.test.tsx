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

  it("applies RO WO RW action rules", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App />);
    await screen.findByText(/已连接：target-a/);

    const roRow = findRowByText("battery.impedance_mohm");
    const woRow = findRowByText("charger.trickle_switch_soc");
    const rwRow = findRowByText("charger.input_current_limit_ma");

    expect(within(roRow).getByRole("button", { name: /读取/ })).toBeInTheDocument();
    expect(within(roRow).queryByRole("button", { name: /写入/ })).not.toBeInTheDocument();
    expect(within(woRow).getByRole("button", { name: /^写入$/ })).toBeInTheDocument();
    expect(within(woRow).queryByRole("button", { name: /读取/ })).not.toBeInTheDocument();
    expect(within(rwRow).getByRole("button", { name: /^读取$/ })).toBeInTheDocument();
    expect(within(rwRow).getByRole("button", { name: /写入并回读/ })).toBeInTheDocument();
  });

  it("reads a readable node", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
      { ok: true, value: "3650", returncode: 0, stdout: "3650\n", stderr: "" }
    ]);
    render(<App />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /^读取$/ }));

    await within(row).findByText("3650");
    expect(fetch).toHaveBeenLastCalledWith("/api/hdc/read-node", expect.objectContaining({ method: "POST" }));
  });

  it("requires confirmation and verifies RW write readback", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
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
    fireEvent.change(within(row).getByLabelText(/charger.input_current_limit_ma 目标写入值/), { target: { value: "3700" } });
    fireEvent.click(within(row).getByRole("button", { name: /写入并回读/ }));
    expect(screen.getByRole("dialog", { name: /确认写入节点/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /确认写入/ }));
    await within(row).findByText(/回读一致/);
  });

  it("marks RW readback mismatch", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
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
    fireEvent.change(within(row).getByLabelText(/charger.input_current_limit_ma 目标写入值/), { target: { value: "3700" } });
    fireEvent.click(within(row).getByRole("button", { name: /写入并回读/ }));
    fireEvent.click(screen.getByRole("button", { name: /确认写入/ }));

    await within(row).findByText(/回读不一致/);
  });
});
