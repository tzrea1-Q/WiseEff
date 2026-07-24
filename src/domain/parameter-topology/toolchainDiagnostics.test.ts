import { describe, expect, it } from "vitest";
import {
  danglingReferenceLabel,
  filterProductWorkbenchDiagnostics,
  formatDanglingReferenceSummary,
  isDanglingReferenceDiagnostic,
  isToolchainCompileNoise,
  partitionDanglingReferenceDiagnostics
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

describe("dangling reference diagnostics", () => {
  const amba = {
    code: "dangling-reference",
    severity: "warning",
    message:
      'Overlay target "&amba" is not defined in the uploaded file set; its properties are attached to a synthetic anchor node so parameters stay manageable (full-tree resolution unavailable until the definition is provided)'
  };
  const charging = {
    code: "dangling-reference",
    severity: "warning",
    message:
      'Overlay target "&charging_core" is not defined in the uploaded file set; its properties are attached to a synthetic anchor node so parameters stay manageable (full-tree resolution unavailable until the definition is provided)'
  };

  it("recognizes dangling-reference by code or message shape", () => {
    expect(isDanglingReferenceDiagnostic(amba)).toBe(true);
    expect(
      isDanglingReferenceDiagnostic({
        message: amba.message
      })
    ).toBe(true);
    expect(
      isDanglingReferenceDiagnostic({
        code: "TOPOLOGY_NOT_READY",
        message: "拓扑尚未就绪，无法提交编辑。"
      })
    ).toBe(false);
  });

  it("extracts overlay labels and collapses into one summary", () => {
    expect(danglingReferenceLabel(amba)).toBe("amba");
    const partitioned = partitionDanglingReferenceDiagnostics([
      amba,
      charging,
      { code: "TOPOLOGY_NOT_READY", message: "拓扑尚未就绪，无法提交编辑。" }
    ]);
    expect(partitioned.other).toEqual([
      { code: "TOPOLOGY_NOT_READY", message: "拓扑尚未就绪，无法提交编辑。" }
    ]);
    expect(partitioned.summary).toEqual({
      count: 2,
      labels: ["amba", "charging_core"],
      severity: "warning"
    });
    expect(formatDanglingReferenceSummary(partitioned.summary!)).toBe(
      "2 个悬空 overlay 引用已自锚定，参数仍可管理"
    );
  });
});
