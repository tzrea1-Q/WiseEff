import { describe, expect, it } from "vitest";
import {
  filterProductWorkbenchDiagnostics,
  isToolchainCompileNoise
} from "./toolchainDiagnostics";

describe("isToolchainCompileNoise", () => {
  it("matches dtc compile warning patterns from seed boards", () => {
    expect(
      isToolchainCompileNoise({
        code: "ranges_format",
        message: "aurora-board.dts:525.9-30: Warning (ranges_format): empty ranges"
      })
    ).toBe(true);
    expect(
      isToolchainCompileNoise({
        message:
          "aurora-board.dts:15.2-18: Warning (unit_address_vs_reg): node has a unit name, but no reg property"
      })
    ).toBe(true);
    expect(
      isToolchainCompileNoise({
        code: "compile-failed",
        message: "injected compile-failed",
        severity: "error"
      })
    ).toBe(true);
  });

  it("keeps product governance diagnostics", () => {
    expect(
      isToolchainCompileNoise({
        code: "TOPOLOGY_NOT_READY",
        message: "拓扑尚未就绪，无法提交编辑。"
      })
    ).toBe(false);
    expect(
      isToolchainCompileNoise({
        code: "BINDING_NOT_FOUND",
        message: "绑定不存在。"
      })
    ).toBe(false);
    expect(
      isToolchainCompileNoise({
        code: "schema-blocked",
        message: "Parameter spec shape blocks typed edit for gpio_int."
      })
    ).toBe(false);
  });
});

describe("filterProductWorkbenchDiagnostics", () => {
  it("removes toolchain noise and keeps product errors", () => {
    const filtered = filterProductWorkbenchDiagnostics([
      { code: "ranges_format", message: "Warning (ranges_format): empty ranges" },
      { code: "TOPOLOGY_NOT_READY", message: "拓扑尚未就绪，无法提交编辑。" }
    ]);
    expect(filtered).toEqual([
      { code: "TOPOLOGY_NOT_READY", message: "拓扑尚未就绪，无法提交编辑。" }
    ]);
  });
});
