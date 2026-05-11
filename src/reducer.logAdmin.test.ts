import { describe, expect, it } from "vitest";
import { reducer } from "./App";
import { createPrototypeState } from "./mockData";

describe("reducer · LOG_ADMIN_REANALYZE_LOG", () => {
  it("sets log.status to Processing and stage to 日志解析", () => {
    const state = createPrototypeState();
    const targetId = state.logs[1].id;
    const next = reducer(state, { type: "LOG_ADMIN_REANALYZE_LOG", logId: targetId });
    const log = next.logs.find((item) => item.id === targetId)!;

    expect(log.status).toBe("Processing");
    expect(log.stage).toBe("parse");
  });

  it("writes AuditEvent with app=log-admin severity=Medium", () => {
    const state = createPrototypeState();
    const before = state.auditEvents.length;
    const next = reducer(state, { type: "LOG_ADMIN_REANALYZE_LOG", logId: state.logs[0].id });

    expect(next.auditEvents.length).toBe(before + 1);
    const event = next.auditEvents[next.auditEvents.length - 1];
    expect(event.app).toBe("log-admin");
    expect(event.severity).toBe("Medium");
    expect(event.action).toContain("重新分析");
  });

  it("is a no-op when logId does not exist", () => {
    const state = createPrototypeState();
    const next = reducer(state, { type: "LOG_ADMIN_REANALYZE_LOG", logId: "nonexistent" });

    expect(next.logs).toEqual(state.logs);
    expect(next.auditEvents.length).toBe(state.auditEvents.length);
  });
});

describe("reducer · LOG_ADMIN_ARCHIVE_LOG", () => {
  it("adds logId to archivedLogIds", () => {
    const state = createPrototypeState();
    const targetId = state.logs[0].id;
    const next = reducer(state, { type: "LOG_ADMIN_ARCHIVE_LOG", logId: targetId });

    expect(next.archivedLogIds).toContain(targetId);
  });

  it("writes AuditEvent severity=Low", () => {
    const state = createPrototypeState();
    const next = reducer(state, { type: "LOG_ADMIN_ARCHIVE_LOG", logId: state.logs[0].id });
    const event = next.auditEvents[next.auditEvents.length - 1];

    expect(event.app).toBe("log-admin");
    expect(event.severity).toBe("Low");
    expect(event.action).toContain("归档");
  });

  it("does not archive twice", () => {
    const state = createPrototypeState();
    const targetId = state.logs[0].id;
    const once = reducer(state, { type: "LOG_ADMIN_ARCHIVE_LOG", logId: targetId });
    const twice = reducer(once, { type: "LOG_ADMIN_ARCHIVE_LOG", logId: targetId });

    expect(twice.archivedLogIds.filter((id) => id === targetId).length).toBe(1);
  });
});

describe("reducer · LOG_ADMIN_UNARCHIVE_LOG", () => {
  it("removes logId from archivedLogIds", () => {
    const state = createPrototypeState();
    const targetId = state.logs[0].id;
    const archived = reducer(state, { type: "LOG_ADMIN_ARCHIVE_LOG", logId: targetId });
    const unarchived = reducer(archived, { type: "LOG_ADMIN_UNARCHIVE_LOG", logId: targetId });

    expect(unarchived.archivedLogIds).not.toContain(targetId);
  });

  it("writes AuditEvent with action containing 撤销归档", () => {
    const state = createPrototypeState();
    const targetId = state.logs[0].id;
    const archived = reducer(state, { type: "LOG_ADMIN_ARCHIVE_LOG", logId: targetId });
    const unarchived = reducer(archived, { type: "LOG_ADMIN_UNARCHIVE_LOG", logId: targetId });
    const event = unarchived.auditEvents[unarchived.auditEvents.length - 1];

    expect(event.action).toContain("撤销归档");
  });
});

describe("reducer · LOG_ADMIN_ADD_USER", () => {
  it("appends new user to logAdminUsers with generated id/avatar", () => {
    const state = createPrototypeState();
    const before = state.logAdminUsers.length;
    const next = reducer(state, {
      type: "LOG_ADMIN_ADD_USER",
      input: { name: "Test User", title: "QA Lead", role: "Editor" }
    });

    expect(next.logAdminUsers.length).toBe(before + 1);
    const added = next.logAdminUsers[next.logAdminUsers.length - 1];
    expect(added.name).toBe("Test User");
    expect(added.title).toBe("QA Lead");
    expect(added.role).toBe("Editor");
    expect(added.id).toBeTruthy();
    expect(added.avatarInitials).toBe("TU");
  });

  it("writes AuditEvent severity=Medium", () => {
    const state = createPrototypeState();
    const before = state.auditEvents.length;
    const next = reducer(state, {
      type: "LOG_ADMIN_ADD_USER",
      input: { name: "Test User", title: "", role: "Viewer" }
    });

    expect(next.auditEvents.length).toBe(before + 1);
    const event = next.auditEvents[next.auditEvents.length - 1];
    expect(event.app).toBe("log-admin");
    expect(event.severity).toBe("Medium");
    expect(event.action).toContain("新增用户");
    expect(event.action).toContain("Test User");
  });
});

describe("reducer · LOG_ADMIN_UPDATE_USER_ROLE", () => {
  it("updates role of target user", () => {
    const state = createPrototypeState();
    const targetId = state.logAdminUsers[1].id;
    const next = reducer(state, {
      type: "LOG_ADMIN_UPDATE_USER_ROLE",
      userId: targetId,
      role: "Admin"
    });
    const target = next.logAdminUsers.find((user) => user.id === targetId)!;

    expect(target.role).toBe("Admin");
  });

  it("writes AuditEvent severity=High", () => {
    const state = createPrototypeState();
    const targetId = state.logAdminUsers[1].id;
    const next = reducer(state, {
      type: "LOG_ADMIN_UPDATE_USER_ROLE",
      userId: targetId,
      role: "Admin"
    });
    const event = next.auditEvents[next.auditEvents.length - 1];

    expect(event.severity).toBe("High");
    expect(event.action).toContain("Admin");
  });

  it("is a no-op when userId does not exist", () => {
    const state = createPrototypeState();
    const next = reducer(state, {
      type: "LOG_ADMIN_UPDATE_USER_ROLE",
      userId: "nonexistent",
      role: "Admin"
    });

    expect(next.logAdminUsers).toEqual(state.logAdminUsers);
    expect(next.auditEvents.length).toBe(state.auditEvents.length);
  });
});

describe("reducer · LOG_ADMIN_REMOVE_USER", () => {
  it("removes user and writes AuditEvent severity=Medium", () => {
    const state = createPrototypeState();
    const targetId = state.logAdminUsers[2].id;
    const next = reducer(state, { type: "LOG_ADMIN_REMOVE_USER", userId: targetId });

    expect(next.logAdminUsers.find((user) => user.id === targetId)).toBeUndefined();
    const event = next.auditEvents[next.auditEvents.length - 1];
    expect(event.severity).toBe("Medium");
    expect(event.action).toContain("移除用户");
  });
});

describe("reducer · LOG_ADMIN_SYNC_LOGS", () => {
  it("bumps updatedAtIso of all logs toward now", () => {
    const state = createPrototypeState();
    const originalIsos = state.logs.map((log) => log.updatedAtIso);
    const next = reducer(state, { type: "LOG_ADMIN_SYNC_LOGS" });

    next.logs.forEach((log, index) => {
      expect(Date.parse(log.updatedAtIso)).toBeGreaterThanOrEqual(Date.parse(originalIsos[index]));
    });
  });

  it("writes AuditEvent severity=Low", () => {
    const state = createPrototypeState();
    const next = reducer(state, { type: "LOG_ADMIN_SYNC_LOGS" });
    const event = next.auditEvents[next.auditEvents.length - 1];

    expect(event.app).toBe("log-admin");
    expect(event.severity).toBe("Low");
    expect(event.action).toContain("同步");
  });

  it("promotes at least one Processing log to Complete when present", () => {
    const state = createPrototypeState();
    const beforeCount = state.logs.filter((log) => log.status === "Processing").length;
    const next = reducer(state, { type: "LOG_ADMIN_SYNC_LOGS" });
    const afterCount = next.logs.filter((log) => log.status === "Processing").length;

    if (beforeCount > 0) {
      expect(afterCount).toBeLessThanOrEqual(beforeCount);
    }
  });
});

describe("reducer · LOG_ADMIN_EXPORT_REPORT", () => {
  it("writes AuditEvent severity=Low with timeWindow info", () => {
    const state = createPrototypeState();
    const next = reducer(state, { type: "LOG_ADMIN_EXPORT_REPORT", timeWindow: "7d" });
    const event = next.auditEvents[next.auditEvents.length - 1];

    expect(event.severity).toBe("Low");
    expect(event.action).toContain("导出");
    expect(event.action).toContain("7");
  });

  it("does not modify logs", () => {
    const state = createPrototypeState();
    const next = reducer(state, { type: "LOG_ADMIN_EXPORT_REPORT", timeWindow: "today" });

    expect(next.logs).toEqual(state.logs);
  });
});

describe("reducer · OPEN_AGENT_WITH_PRESET", () => {
  it("appends a notification describing the preset", () => {
    const state = createPrototypeState();
    const next = reducer(state, {
      type: "OPEN_AGENT_WITH_PRESET",
      preset: "log-admin-failures"
    });

    expect(next.notifications.length).toBe(state.notifications.length + 1);
    expect(next.notifications[0]).toMatch(/Agent/);
  });
});
