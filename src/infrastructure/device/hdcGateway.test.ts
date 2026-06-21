import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHdcGateway } from "./hdcGateway";
import { detectHdcTargets, readNodeValue, writeNodeValue } from "@/hdcClient";

vi.mock("@/hdcClient", () => ({
  detectHdcTargets: vi.fn(),
  readNodeValue: vi.fn(),
  writeNodeValue: vi.fn()
}));

describe("createHdcGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes detected hdc targets for the debugging port", async () => {
    vi.mocked(detectHdcTargets).mockResolvedValueOnce({
      ok: true,
      targets: ["target-a", "target-b"],
      activeTarget: "target-a"
    });

    await expect(createHdcGateway().detectTargets()).resolves.toEqual([
      { id: "target-a", label: "target-a（当前）" },
      { id: "target-b", label: "target-b" }
    ]);
  });

  it("accepts api-mode detection input while preserving local hdc behavior", async () => {
    vi.mocked(detectHdcTargets).mockResolvedValueOnce({
      ok: true,
      targets: ["target-a"],
      activeTarget: "target-a"
    });

    await expect(createHdcGateway().detectTargets({ projectId: "aurora", deviceId: "sim-device-1" })).resolves.toEqual([
      { id: "target-a", label: "target-a（当前）" }
    ]);
    expect(detectHdcTargets).toHaveBeenCalledWith();
  });

  it("surfaces failed hdc target detection responses", async () => {
    vi.mocked(detectHdcTargets).mockResolvedValueOnce({
      ok: false,
      targets: [],
      error: "hdc missing",
      stderr: "not found"
    });

    await expect(createHdcGateway().detectTargets()).rejects.toThrow("hdc missing");
  });

  it("passes read requests through to the hdc client", async () => {
    const input = { target: "target-a", nodePath: "/sys/node" };
    const response = { ok: true, value: "42" };
    vi.mocked(readNodeValue).mockResolvedValueOnce(response);

    await expect(createHdcGateway().readNode(input)).resolves.toBe(response);
    expect(readNodeValue).toHaveBeenCalledWith(input);
  });

  it("rejects local read requests without a node path", async () => {
    await expect(createHdcGateway().readNode({ parameterId: "param-1" })).rejects.toThrow("HDC nodePath is required.");
    expect(readNodeValue).not.toHaveBeenCalled();
  });

  it("passes write requests through to the hdc client", async () => {
    const input = { target: "target-a", nodePath: "/sys/node", value: "1", readBack: true };
    const response = { ok: true, value: "1", verified: true };
    vi.mocked(writeNodeValue).mockResolvedValueOnce(response);

    await expect(createHdcGateway().writeNode(input)).resolves.toBe(response);
    expect(writeNodeValue).toHaveBeenCalledWith(input);
  });

  it("rejects local write requests without a node path", async () => {
    await expect(createHdcGateway().writeNode({ parameterId: "param-1", value: "1", readBack: true })).rejects.toThrow(
      "HDC nodePath is required."
    );
    expect(writeNodeValue).not.toHaveBeenCalled();
  });
});
