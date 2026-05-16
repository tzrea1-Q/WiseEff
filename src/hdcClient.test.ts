import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectHdcTargets, readNodeValue, writeNodeValue } from "./hdcClient";

describe("hdcClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("detects hdc targets", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      targets: ["target-a"],
      activeTarget: "target-a"
    })));

    await expect(detectHdcTargets()).resolves.toMatchObject({ activeTarget: "target-a" });
    expect(fetch).toHaveBeenCalledWith("/api/hdc/targets");
  });

  it("reads a node value", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      value: "42",
      returncode: 0,
      stdout: "42\n",
      stderr: ""
    })));

    await expect(readNodeValue({ target: "t1", nodePath: "/sys/x" })).resolves.toMatchObject({ value: "42" });
    expect(fetch).toHaveBeenCalledWith("/api/hdc/read-node", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ target: "t1", nodePath: "/sys/x" })
    }));
  });

  it("writes a node value with readback", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      verified: true,
      value: "1"
    })));

    await expect(writeNodeValue({
      target: "t1",
      nodePath: "/sys/x",
      value: "1",
      readBack: true
    })).resolves.toMatchObject({ verified: true });
  });
});
