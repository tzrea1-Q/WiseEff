import { describe, expect, it } from "vitest";

import { createApiBootstrapState } from "./apiBootstrapState";

describe("createApiBootstrapState", () => {
  it("starts API mode without seeded demo business data", () => {
    const state = createApiBootstrapState();

    expect(state.activeProjectId).not.toBe("aurora");
    expect(state.parameters).toEqual([]);
    expect(state.changeRequests).toEqual([]);
    expect(state.parameterSubmissionRounds).toEqual([]);
    expect(state.projectInitializationStatuses).toEqual({});
    expect(state.logs).toEqual([]);
    expect(state.archivedLogIds).toEqual([]);
    expect(state.devices).toEqual([]);
    expect(state.debugParameters).toEqual([]);
    expect(state.users).toEqual([]);
    expect(state.currentUserId).toBe("");
    expect(state.auditEvents).toEqual([]);
    expect(state.notifications).toEqual([]);
  });
});
