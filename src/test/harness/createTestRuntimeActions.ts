import { vi } from "vitest";

import type { DebuggingRuntimeActions } from "@/application/debugging/debuggingRuntime";
import type { LogRuntimeActions } from "@/application/logs/logRuntime";

/** Complete observable action surface for direct DebuggingPage component tests. */
export function createTestDebuggingRuntimeActions(
  overrides: Partial<DebuggingRuntimeActions> = {}
): DebuggingRuntimeActions {
  const base: DebuggingRuntimeActions = {
    refresh: vi.fn().mockResolvedValue(undefined),
    detectAndStartSession: vi.fn().mockResolvedValue({
      session: {
        id: "api-session-1",
        deviceId: "device-n07",
        targetId: "api-target-1",
        status: "active",
        startedAt: "2026-05-27T09:00:00.000Z",
        endedAt: null
      },
      target: {
        id: "api-target-1",
        deviceId: "device-n07",
        label: "API Target"
      }
    }),
    readNode: vi.fn().mockResolvedValue({ ok: true }),
    writeNode: vi.fn().mockResolvedValue({ ok: true }),
    pushValues: vi.fn().mockResolvedValue(undefined),
    rollbackSnapshot: vi.fn().mockResolvedValue(undefined),
    rollbackLastSnapshot: vi.fn().mockResolvedValue(undefined),
    connectDevice: vi.fn().mockResolvedValue(undefined)
  };

  return { ...base, ...overrides };
}

/** Complete observable action surface for direct LogAdminPage component tests. */
export function createTestLogRuntimeActions(
  overrides: Partial<LogRuntimeActions> = {}
): LogRuntimeActions {
  const base: LogRuntimeActions = {
    refresh: vi.fn().mockResolvedValue(undefined),
    upload: vi.fn().mockResolvedValue(undefined),
    rerun: vi.fn().mockResolvedValue(undefined),
    archive: vi.fn().mockResolvedValue(undefined),
    unarchive: vi.fn().mockResolvedValue(undefined),
    submitFeedback: vi.fn().mockResolvedValue(undefined),
    listLogDomains: vi.fn().mockResolvedValue([]),
    createLogDomain: vi.fn().mockResolvedValue(null),
    updateLogDomain: vi.fn().mockResolvedValue(null),
    archiveLogDomain: vi.fn().mockResolvedValue(null),
    listLogDomainKnowledgeLinks: vi.fn().mockResolvedValue([]),
    setLogDomainKnowledgeLinks: vi.fn().mockResolvedValue(null),
    listFeedbackInsights: vi.fn().mockResolvedValue([]),
    setLogDomainWebhook: vi.fn().mockResolvedValue(null),
    listLogDomainWebhookDeliveries: vi.fn().mockResolvedValue([]),
    sendLogDomainWebhookTest: vi.fn().mockResolvedValue(null)
  };

  return { ...base, ...overrides };
}
