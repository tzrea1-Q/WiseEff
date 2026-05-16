import { describe, expect, it } from "vitest";
import type { AgentToolName } from "./agent/types";
import type { DebugParameter } from "./debugging/types";
import type { LogStageId } from "./logs/types";
import type { RequestStatus, RiskLevel } from "./parameters/types";
import type { RoleCapability } from "./users/types";

describe("domain type modules", () => {
  it("loads each pure type module", async () => {
    await expect(
      Promise.all([
        import("./parameters/types"),
        import("./logs/types"),
        import("./debugging/types"),
        import("./users/types"),
        import("./audit/types"),
        import("./agent/types")
      ])
    ).resolves.toHaveLength(6);
  });

  it("keeps stable literal domains", () => {
    const risk: RiskLevel = "High";
    const status: RequestStatus = "待审阅";
    const stage: LogStageId = "rootcause";
    const capability: RoleCapability = "manage-permissions";
    const toolName: AgentToolName = "parameter.scanOrphans";

    expect(risk).toBe("High");
    expect(status).toBe("待审阅");
    expect(stage).toBe("rootcause");
    expect(capability).toBe("manage-permissions");
    expect(toolName).toBe("parameter.scanOrphans");
  });

  it("preserves debug node metadata", () => {
    const parameter = {
      id: "debug-test",
      name: "Test parameter",
      key: "test.value",
      description: "Synthetic debug parameter",
      module: "Test Module",
      currentValue: "1",
      targetValue: "2",
      unit: "mA",
      range: "0-10",
      risk: "Low",
      status: "已同步",
      nodePath: "/sys/test/value",
      accessMode: "RW"
    } satisfies DebugParameter;

    expect(parameter.nodePath).toBe("/sys/test/value");
    expect(parameter.accessMode).toBe("RW");
  });
});
