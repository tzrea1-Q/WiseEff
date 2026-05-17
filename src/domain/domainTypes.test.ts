import { describe, expect, it } from "vitest";
import type { AgentToolName, AgentTurn } from "./agent/types";
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

  it("keeps the planned agent turn shape", () => {
    const turn = {
      session: {
        id: "session-1",
        context: {
          path: "/parameters",
          pageKey: "parameters",
          projectId: "project-1",
          roleId: "engineer"
        },
        messages: [
          {
            id: "message-1",
            role: "user",
            content: "Review pending cleanup",
            createdAt: "2026-05-17T00:00:00.000Z"
          }
        ]
      },
      messages: [
        {
          id: "message-2",
          role: "assistant",
          content: "I found one cleanup draft.",
          createdAt: "2026-05-17T00:00:01.000Z"
        }
      ],
      toolCalls: [
        {
          id: "tool-call-1",
          name: "parameter.draftCleanupPlan",
          label: "Draft cleanup plan",
          payload: { includeOrphans: true },
          requiresApproval: true
        }
      ],
      approvals: [
        {
          id: "approval-1",
          toolCallId: "tool-call-1",
          title: "Apply cleanup draft",
          message: "Approve the generated parameter cleanup draft."
        }
      ]
    } satisfies AgentTurn;

    expect(turn.session.id).toBe("session-1");
    expect(turn.messages[0].role).toBe("assistant");
    expect(turn.toolCalls[0]).toMatchObject({
      label: "Draft cleanup plan",
      payload: { includeOrphans: true },
      requiresApproval: true
    });
    expect(turn.approvals[0].toolCallId).toBe("tool-call-1");
  });
});
