import { describe, expect, it, vi } from "vitest";

import type { AuditEventDto, AuditEventListResponse } from "@/domain/audit/types";
import {
  initialParameterAdminState,
  parameterAdminReducer,
  type ParameterAdminAction
} from "./parameterAdminState";
import {
  mapAuditDtoToRecentEvent,
  refreshParameterAdminRecentAudits
} from "./refreshParameterAdminRecentAudits";

function sampleDto(overrides: Partial<AuditEventDto> = {}): AuditEventDto {
  return {
    id: "ae-100",
    organizationId: "org-1",
    projectId: "proj-1",
    actorUserId: "u-1",
    actorType: "user",
    actorName: "Wang Jie",
    app: "parameter-admin",
    kind: "parameter-module-admin-create",
    action: "创建业务模块「充电」",
    severity: "Low",
    targetType: "parameter-module",
    targetId: "mod-1",
    metadata: { reason: "governance" },
    traceId: "trace-1",
    createdAt: "2026-08-05T12:00:00.000Z",
    ...overrides
  };
}

describe("mapAuditDtoToRecentEvent", () => {
  it("projects audit-center DTOs into admin recent-event view models", () => {
    const event = mapAuditDtoToRecentEvent(sampleDto());
    expect(event).toEqual({
      id: "ae-100",
      kind: "parameter-module-admin-create",
      summary: "创建业务模块「充电」",
      reason: "governance",
      recordedAt: "2026-08-05T12:00:00.000Z"
    });
  });
});

describe("refreshParameterAdminRecentAudits", () => {
  it("dispatches SET_RECENT_AUDIT_EVENTS from listAuditEvents", async () => {
    const listAuditEvents = vi.fn(async (): Promise<AuditEventListResponse> => ({
      items: [sampleDto(), sampleDto({ id: "ae-101", action: "删除业务模块" })],
      nextCursor: null
    }));
    const dispatched: ParameterAdminAction[] = [];
    const dispatch = (action: ParameterAdminAction) => {
      dispatched.push(action);
    };

    await refreshParameterAdminRecentAudits({ dispatch, listAuditEvents });

    expect(listAuditEvents).toHaveBeenCalledWith({
      apps: ["parameter-management", "parameter-admin", "parameters"],
      limit: 8
    });
    expect(dispatched).toEqual([
      {
        type: "SET_RECENT_AUDIT_EVENTS",
        events: [
          {
            id: "ae-100",
            kind: "parameter-module-admin-create",
            summary: "创建业务模块「充电」",
            reason: "governance",
            recordedAt: "2026-08-05T12:00:00.000Z"
          },
          {
            id: "ae-101",
            kind: "parameter-module-admin-create",
            summary: "删除业务模块",
            reason: "governance",
            recordedAt: "2026-08-05T12:00:00.000Z"
          }
        ]
      }
    ]);

    const next = parameterAdminReducer(initialParameterAdminState, dispatched[0]!);
    expect(next.recentAuditEvents).toHaveLength(2);
  });

  it("leaves recent events unchanged when the audit list fails", async () => {
    const listAuditEvents = vi.fn(async () => {
      throw new Error("network");
    });
    const dispatched: ParameterAdminAction[] = [];

    await refreshParameterAdminRecentAudits({
      dispatch: (action) => {
        dispatched.push(action);
      },
      listAuditEvents
    });

    expect(dispatched).toEqual([]);
  });
});
