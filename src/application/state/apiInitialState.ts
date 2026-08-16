import type { PrototypeState, User } from "@/domain/prototype/types";
import {
  clonePowerManagementConfig,
  createEmptyPowerManagementConfig
} from "@/powerManagementConfig";

export const users: User[] = [
  { id: "u-xu-yun", name: "Xu Yun", email: "xu@chargelab.cn", username: "xu.yun", title: "Platform Owner", roleId: "admin", isActive: true, createdAt: "2024-11-02T09:30:00.000Z", lastActive: "just now" },
  {
    id: "u-platform-admin",
    name: "Platform Operator",
    email: "platform@chargelab.cn",
    username: "platform.admin",
    title: "Platform Super Admin",
    roleId: "platform-admin",
    isActive: true,
    createdAt: "2025-05-01T09:00:00.000Z",
    lastActive: "just now"
  },
  { id: "u-zhao-heng", name: "Zhao Heng", email: "zhao@chargelab.cn", username: "zhao.heng", title: "Hardware Engineer", roleId: "hardware-user", isActive: true, createdAt: "2025-01-14T03:12:00.000Z", lastActive: "2h ago" },
  { id: "u-liu-min", name: "Liu Min", email: "liu@chargelab.cn", username: "liu.min", title: "Software Engineer", roleId: "software-user", isActive: true, createdAt: "2025-02-03T08:04:00.000Z", lastActive: "today 09:12" },
  { id: "u-wang-jie", name: "Wang Jie", email: "wang@chargelab.cn", username: "wang.jie", title: "Hardware Reviewer", roleId: "hardware-committer", isActive: true, createdAt: "2024-12-20T12:00:00.000Z", lastActive: "yesterday" },
  { id: "u-chen-na", name: "Chen Na", email: "chen@chargelab.cn", username: "chen.na", title: "Software Integrator", roleId: "software-user", isActive: true, createdAt: "2025-03-10T10:00:00.000Z", lastActive: "today 10:00" },
  { id: "u-li-peng", name: "Li Peng", email: "lipeng@chargelab.cn", username: "li.peng", title: "Hardware Committer", roleId: "hardware-committer", isActive: true, createdAt: "2025-03-22T11:00:00.000Z", lastActive: "3d ago" },
  { id: "u-sun-mei", name: "Sun Mei", email: "sun@chargelab.cn", username: "sun.mei", title: "Software Reviewer", roleId: "software-committer", isActive: true, createdAt: "2025-04-01T09:00:00.000Z", lastActive: "5h ago" },
  { id: "u-tao-lin", name: "Tao Lin", email: "tao@chargelab.cn", username: "tao.lin", title: "External Viewer", roleId: "guest", isActive: false, createdAt: "2025-04-15T14:00:00.000Z", lastActive: "disabled" }
];

/**
 * API-mode initial state: structural fields (users, config schema) stay,
 * but every business-data slice starts empty so demo records can never be read
 * as production data. The API runtime hydrates the slices after authentication.
 *
 * Built as an explicit empty shell — not a spread of seeded `createPrototypeState()`.
 */
export function createApiInitialState(): PrototypeState {
  const currentUserId = "u-xu-yun";
  const currentUser = users.find((user) => user.id === currentUserId);

  return {
    activeProjectId: "aurora",
    activeRoleId: currentUser?.roleId ?? "guest",
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
    users,
    currentUserId
  };
}
