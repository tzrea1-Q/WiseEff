import type { PrototypeState } from "@/domain/prototype/types";
import {
  clonePowerManagementConfig,
  createEmptyPowerManagementConfig
} from "@/powerManagementConfig";

/**
 * API-mode initial state: structural fields (users, config schema) stay,
 * but every business-data slice starts empty so demo records can never be read
 * as production data. The API runtime hydrates the slices after authentication.
 *
 * Built as an explicit empty shell — not a spread of seeded `createPrototypeState()`.
 */
export function createApiInitialState(): PrototypeState {
  return {
    activeProjectId: "aurora",
    activeRoleId: "guest",
    configDraft: clonePowerManagementConfig(createEmptyPowerManagementConfig()),
    parameters: [],
    changeRequests: [],
    parameterDrafts: [],
    parameterSubmissionRounds: [],
    parameterReviewDecisions: [],
    parameterInitializationDrafts: [],
    parameterInitializationReviews: [],
    projectInitializationStatuses: {},
    logs: [],
    archivedLogIds: [],
    devices: [],
    debugParameters: [],
    auditEvents: [],
    notifications: [],
    notificationInbox: [],
    lastDebugSnapshot: null,
    debugEvents: [],
    pushedDebugIds: [],
    debuggingSessionStartedAt: null,
    debuggingActiveSessionId: null,
    persistedConfigSnapshot: clonePowerManagementConfig(createEmptyPowerManagementConfig()),
    users: [],
    currentUserId: ""
  };
}
