import { createPrototypeState, type PrototypeState } from "@/mockData";
import type { PowerManagementConfig } from "@/powerManagementConfig";

function createEmptyPowerManagementConfig(): PowerManagementConfig {
  return {
    projects: [],
    parameterLibrary: [],
    debugParameters: []
  };
}

export function createApiBootstrapState(): PrototypeState {
  const shell = createPrototypeState(createEmptyPowerManagementConfig());
  const emptyConfig = createEmptyPowerManagementConfig();

  return {
    ...shell,
    activeProjectId: "",
    activeRoleId: "guest",
    configDraft: emptyConfig,
    parameters: [],
    changeRequests: [],
    aiFeedback: [],
    parameterSubmissionRounds: [],
    parameterInitializationDrafts: [],
    parameterInitializationReviews: [],
    projectInitializationStatuses: {},
    logs: [],
    logAdminUsers: [],
    archivedLogIds: [],
    devices: [],
    debugParameters: [],
    auditEvents: [],
    developers: [],
    notifications: [],
    lastDebugSnapshot: null,
    debugEvents: [],
    pushedDebugIds: [],
    debuggingSessionStartedAt: null,
    debuggingActiveSessionId: null,
    persistedConfigSnapshot: emptyConfig,
    users: [],
    currentUserId: "",
    lastExportedSnapshot: "",
    _undoStack: null,
    insightDismissedIds: [],
    aiFlaggedImportIds: []
  };
}
