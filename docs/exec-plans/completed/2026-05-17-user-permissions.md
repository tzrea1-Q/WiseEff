# User Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared `/user-permissions` page with four platform roles and enforce those permissions across navigation, direct URL access, and key page actions.

**Architecture:** Put role definitions in `src/domain/users`, route/action checks in a centralized `src/app/permissions.ts` policy, and keep UI enforcement in `AppShell`, `PageRouter`, and focused page components. Reuse existing mock-state reducer actions where possible, but tighten their role types and add self-lockout protections.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, lucide-react, existing WiseEff component and CSS conventions.

---

## File Structure

- Create `src/domain/users/permissions.test.ts`: role definition, migration, and permission-key tests.
- Modify `src/domain/users/types.ts`: replace the generic role model with platform role ids, permission keys, role definitions, user accounts, and migration helpers.
- Create `src/app/permissions.test.ts`: page/action policy tests.
- Create `src/app/permissions.ts`: centralized `canAccessPage`, `canPerform`, required-role, disabled-reason, and fallback helpers.
- Modify `src/mockData.ts`: import/re-export user domain types, migrate seeded users to platform role ids, add user titles and `lastActive`, and keep `activeRoleId` platform-based.
- Modify `src/App.tsx`: tighten user actions, add reducer permission guards, pass current role to shell/navigation/router, and wire utility navigation to `/user-permissions`.
- Create `src/UserPermissionsPage.test.tsx`: page behavior tests.
- Create `src/UserPermissionsPage.tsx`: shared platform user permissions page.
- Modify `src/appConfig.ts`: add `user-permissions` page config via `getPageByPath`, add utility item path metadata, and keep it out of `navigationItems`.
- Modify `src/appConfig.test.ts`: route and utility tests.
- Modify `src/app/routes.tsx`: add permission-denied handling and route `user-permissions`.
- Modify `src/ParametersPage.tsx` and `src/components/ParametersTable.tsx`: read-only Guest mode.
- Modify `src/ParametersPage.test.tsx`: read-only Guest tests.
- Modify `src/LogAdminPage.tsx` and `src/LogAdminPage.test.tsx`: remove private log-admin user editing and replace it with a shared-permissions entry point.
- Modify `src/ParameterAdminPage.tsx` and `src/workspaceHeaderIntegration.test.tsx`: make the permissions affordance navigate to `/user-permissions`.
- Modify `src/styles.css`: add restrained operational styling for the new permissions page and permission-denied state.
- Create `src/permissionRouting.test.tsx`: integration coverage for sidebar filtering and direct URL denial.

---

### Task 1: Platform User Domain

**Files:**
- Modify: `src/domain/users/types.ts`
- Create: `src/domain/users/permissions.test.ts`

- [ ] **Step 1: Write the failing domain test**

Create `src/domain/users/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  comparePlatformRoles,
  getPlatformRole,
  migrateLegacyRoleId,
  platformRoles,
  roleHasPermission
} from "./types";

describe("platform user roles", () => {
  it("defines the four approved platform roles in privilege order", () => {
    expect(platformRoles.map((role) => role.id)).toEqual(["guest", "user", "committer", "admin"]);
  });

  it("maps legacy prototype roles into platform roles", () => {
    expect(migrateLegacyRoleId("hardware")).toBe("guest");
    expect(migrateLegacyRoleId("project")).toBe("user");
    expect(migrateLegacyRoleId("parameter-admin")).toBe("committer");
    expect(migrateLegacyRoleId("admin")).toBe("admin");
    expect(migrateLegacyRoleId("unknown-role")).toBe("guest");
    expect(migrateLegacyRoleId("")).toBe("guest");
  });

  it("keeps Guest read-only and Admin fully privileged", () => {
    expect(roleHasPermission("guest", "parameter:view")).toBe(true);
    expect(roleHasPermission("guest", "parameter:edit")).toBe(false);
    expect(roleHasPermission("admin", "users:manage")).toBe(true);
    expect(roleHasPermission("admin", "admin:access")).toBe(true);
  });

  it("orders roles by increasing privilege", () => {
    expect(comparePlatformRoles("guest", "user")).toBeLessThan(0);
    expect(comparePlatformRoles("committer", "user")).toBeGreaterThan(0);
    expect(comparePlatformRoles("admin", "admin")).toBe(0);
  });

  it("returns Guest for unknown role lookups", () => {
    expect(getPlatformRole("not-a-role").id).toBe("guest");
  });
});
```

- [ ] **Step 2: Run the domain test and verify it fails**

Run:

```bash
npm test -- src/domain/users/permissions.test.ts
```

Expected: FAIL because `comparePlatformRoles`, `getPlatformRole`, `migrateLegacyRoleId`, `platformRoles`, and `roleHasPermission` are not exported yet.

- [ ] **Step 3: Replace the user domain types**

Replace `src/domain/users/types.ts` with:

```ts
export type PlatformRoleId = "guest" | "user" | "committer" | "admin";

export type PermissionKey =
  | "parameter:view"
  | "parameter:edit"
  | "debugging:use"
  | "logs:upload"
  | "parameter:review"
  | "admin:access"
  | "users:manage";

export type PlatformRole = {
  id: PlatformRoleId;
  name: "Guest" | "User" | "Committer" | "Admin";
  description: string;
  permissions: PermissionKey[];
};

export type UserAccount = {
  id: string;
  name: string;
  email: string;
  title: string;
  roleId: PlatformRoleId;
  isActive: boolean;
  createdAt: string;
  lastActive: string;
};

export const platformRoles: PlatformRole[] = [
  {
    id: "guest",
    name: "Guest",
    description: "Can view parameter pages only.",
    permissions: ["parameter:view"]
  },
  {
    id: "user",
    name: "User",
    description: "Can view and modify parameters, debug devices and nodes, and upload logs for analysis.",
    permissions: ["parameter:view", "parameter:edit", "debugging:use", "logs:upload"]
  },
  {
    id: "committer",
    name: "Committer",
    description: "Can perform User actions and review parameter submissions.",
    permissions: ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review"]
  },
  {
    id: "admin",
    name: "Admin",
    description: "Can perform Committer actions and access application admin pages and user management.",
    permissions: ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review", "admin:access", "users:manage"]
  }
];

const roleRank: Record<PlatformRoleId, number> = {
  guest: 0,
  user: 1,
  committer: 2,
  admin: 3
};

export function isPlatformRoleId(value: string): value is PlatformRoleId {
  return value === "guest" || value === "user" || value === "committer" || value === "admin";
}

export function migrateLegacyRoleId(roleId: string): PlatformRoleId {
  if (isPlatformRoleId(roleId)) {
    return roleId;
  }

  switch (roleId) {
    case "hardware":
      return "guest";
    case "project":
      return "user";
    case "parameter-admin":
      return "committer";
    case "admin":
      return "admin";
    default:
      return "guest";
  }
}

export function getPlatformRole(roleId: string): PlatformRole {
  const migratedRoleId = migrateLegacyRoleId(roleId);
  return platformRoles.find((role) => role.id === migratedRoleId) ?? platformRoles[0];
}

export function roleHasPermission(roleId: string, permission: PermissionKey): boolean {
  return getPlatformRole(roleId).permissions.includes(permission);
}

export function comparePlatformRoles(left: string, right: string): number {
  return roleRank[migrateLegacyRoleId(left)] - roleRank[migrateLegacyRoleId(right)];
}
```

- [ ] **Step 4: Run the domain test and verify it passes**

Run:

```bash
npm test -- src/domain/users/permissions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/users/types.ts src/domain/users/permissions.test.ts
git commit -m "feat: define platform user permissions"
```

---

### Task 2: Central Page And Action Permission Policy

**Files:**
- Create: `src/app/permissions.ts`
- Create: `src/app/permissions.test.ts`

- [ ] **Step 1: Write the failing policy tests**

Create `src/app/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  canAccessPage,
  canPerform,
  getAccessibleFallbackPath,
  getDisabledReason,
  getRequiredRoleForAction,
  getRequiredRoleForPage
} from "./permissions";

describe("app permission policy", () => {
  it("allows Guest to view parameter pages and blocks operational pages", () => {
    expect(canAccessPage("guest", "parameter-home")).toBe(true);
    expect(canAccessPage("guest", "parameters")).toBe(true);
    expect(canAccessPage("guest", "parameter-comparison")).toBe(true);
    expect(canAccessPage("guest", "logs")).toBe(false);
    expect(canAccessPage("guest", "debugging")).toBe(false);
    expect(canAccessPage("guest", "parameter-review")).toBe(false);
  });

  it("allows User to operate but not review or administer", () => {
    expect(canAccessPage("user", "logs")).toBe(true);
    expect(canAccessPage("user", "debugging")).toBe(true);
    expect(canAccessPage("user", "node-debugging")).toBe(true);
    expect(canAccessPage("user", "parameter-review")).toBe(false);
    expect(canAccessPage("user", "parameter-admin")).toBe(false);
  });

  it("allows Committer to review but not access admin backends", () => {
    expect(canAccessPage("committer", "parameter-review")).toBe(true);
    expect(canAccessPage("committer", "log-admin")).toBe(false);
    expect(canAccessPage("committer", "user-permissions")).toBe(false);
  });

  it("allows Admin to access all admin and user management pages", () => {
    expect(canAccessPage("admin", "parameter-admin")).toBe(true);
    expect(canAccessPage("admin", "debugging-admin")).toBe(true);
    expect(canAccessPage("admin", "log-admin")).toBe(true);
    expect(canAccessPage("admin", "user-permissions")).toBe(true);
  });

  it("checks key action permissions", () => {
    expect(canPerform("guest", "parameter.edit")).toBe(false);
    expect(canPerform("user", "parameter.edit")).toBe(true);
    expect(canPerform("user", "parameter.review")).toBe(false);
    expect(canPerform("committer", "parameter.review")).toBe(true);
    expect(canPerform("admin", "users.manage")).toBe(true);
  });

  it("returns required roles and safe fallback routes", () => {
    expect(getRequiredRoleForPage("log-admin")).toBe("admin");
    expect(getRequiredRoleForAction("parameter.review")).toBe("committer");
    expect(getAccessibleFallbackPath("guest")).toBe("/parameter-home");
    expect(getAccessibleFallbackPath("admin")).toBe("/parameter-home");
    expect(getDisabledReason("guest", "parameter.edit")).toBe("Requires User role");
  });
});
```

- [ ] **Step 2: Run policy tests and verify they fail**

Run:

```bash
npm test -- src/app/permissions.test.ts
```

Expected: FAIL because `src/app/permissions.ts` does not exist.

- [ ] **Step 3: Implement the policy module**

Create `src/app/permissions.ts`:

```ts
import type { PageKey } from "@/appConfig";
import {
  comparePlatformRoles,
  migrateLegacyRoleId,
  type PlatformRoleId
} from "@/domain/users/types";

export type ActionKey =
  | "parameter.view"
  | "parameter.edit"
  | "parameter.review"
  | "debugging.use"
  | "logs.upload"
  | "admin.access"
  | "users.manage";

const pageRequiredRoles: Record<PageKey, PlatformRoleId> = {
  home: "guest",
  "parameter-home": "guest",
  parameters: "guest",
  "parameter-submissions": "user",
  "parameter-comparison": "guest",
  "parameter-review": "committer",
  "parameter-admin": "admin",
  "log-dashboard": "user",
  logs: "user",
  "log-admin": "admin",
  debugging: "user",
  "node-debugging": "user",
  "debugging-admin": "admin",
  "user-permissions": "admin"
};

const actionRequiredRoles: Record<ActionKey, PlatformRoleId> = {
  "parameter.view": "guest",
  "parameter.edit": "user",
  "parameter.review": "committer",
  "debugging.use": "user",
  "logs.upload": "user",
  "admin.access": "admin",
  "users.manage": "admin"
};

const roleLabels: Record<PlatformRoleId, string> = {
  guest: "Guest",
  user: "User",
  committer: "Committer",
  admin: "Admin"
};

export function getRequiredRoleForPage(pageKey: PageKey): PlatformRoleId {
  return pageRequiredRoles[pageKey] ?? "guest";
}

export function getRequiredRoleForAction(actionKey: ActionKey): PlatformRoleId {
  return actionRequiredRoles[actionKey];
}

export function canAccessPage(roleId: string, pageKey: PageKey): boolean {
  return comparePlatformRoles(roleId, getRequiredRoleForPage(pageKey)) >= 0;
}

export function canPerform(roleId: string, actionKey: ActionKey): boolean {
  return comparePlatformRoles(roleId, getRequiredRoleForAction(actionKey)) >= 0;
}

export function getDisabledReason(roleId: string, actionKey: ActionKey): string | undefined {
  if (canPerform(roleId, actionKey)) {
    return undefined;
  }
  return `Requires ${roleLabels[getRequiredRoleForAction(actionKey)]} role`;
}

export function getRequiredRoleLabel(roleId: PlatformRoleId): string {
  return roleLabels[roleId];
}

export function getAccessibleFallbackPath(roleId: string): string {
  const normalizedRole = migrateLegacyRoleId(roleId);
  if (comparePlatformRoles(normalizedRole, "guest") >= 0) {
    return "/parameter-home";
  }
  return "/";
}
```

- [ ] **Step 4: Run policy tests and verify they pass**

Run:

```bash
npm test -- src/app/permissions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/permissions.ts src/app/permissions.test.ts
git commit -m "feat: add app permission policy"
```

---

### Task 3: Migrate Mock Users And Reducer User Actions

**Files:**
- Modify: `src/mockData.ts`
- Modify: `src/App.tsx`
- Modify: `src/appReducer.parameterAdmin.test.ts`
- Create: `src/reducer.userPermissions.test.ts`

- [ ] **Step 1: Write failing reducer tests for the new lifecycle rules**

Create `src/reducer.userPermissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { appReducer } from "./App";
import { createPrototypeState } from "./mockData";

describe("shared user permission reducer actions", () => {
  it("adds a platform user with title and role", () => {
    const state = createPrototypeState();
    const next = appReducer(state, {
      type: "ADD_USER",
      name: "Demo Engineer",
      email: "demo@chargelab.cn",
      title: "Validation Engineer",
      roleId: "user"
    });

    expect(next.users).toHaveLength(state.users.length + 1);
    expect(next.users.at(-1)).toMatchObject({
      name: "Demo Engineer",
      email: "demo@chargelab.cn",
      title: "Validation Engineer",
      roleId: "user",
      isActive: true
    });
    expect(next.auditEvents[0].kind).toBe("user-add");
  });

  it("blocks duplicate or invalid email addresses", () => {
    const state = createPrototypeState();

    expect(appReducer(state, {
      type: "ADD_USER",
      name: "Duplicate",
      email: state.users[0].email,
      title: "Duplicate",
      roleId: "user"
    })).toBe(state);

    expect(appReducer(state, {
      type: "ADD_USER",
      name: "Invalid",
      email: "invalid-email",
      title: "Invalid",
      roleId: "user"
    })).toBe(state);
  });

  it("prevents the current Admin from disabling themselves", () => {
    const state = createPrototypeState();
    const next = appReducer(state, {
      type: "TOGGLE_USER_ACTIVE",
      userId: state.currentUserId,
      isActive: false
    });

    expect(next).toBe(state);
  });

  it("prevents the current Admin from downgrading themselves", () => {
    const state = createPrototypeState();
    const next = appReducer(state, {
      type: "ASSIGN_USER_ROLE",
      userId: state.currentUserId,
      roleId: "committer"
    });

    expect(next).toBe(state);
  });

  it("prevents removing the final active Admin", () => {
    const base = createPrototypeState();
    const state = {
      ...base,
      users: base.users.map((user) =>
        user.id === base.currentUserId
          ? user
          : { ...user, roleId: user.roleId === "admin" ? "user" : user.roleId }
      )
    };

    const next = appReducer(state, {
      type: "ASSIGN_USER_ROLE",
      userId: state.currentUserId,
      roleId: "committer"
    });

    expect(next).toBe(state);
  });
});
```

- [ ] **Step 2: Update the existing reducer test expectations**

Modify `src/appReducer.parameterAdmin.test.ts` so role ids match the new platform roles:

```ts
// Replace roleId: "parameter-admin" with roleId: "committer"
// Replace "hardware" expectations with "guest"
// Replace roleId: "project" with roleId: "user"
```

The first test should become:

```ts
it("assigns a user role and records audit metadata", () => {
  const next = appReducer(initialState, {
    type: "ASSIGN_USER_ROLE",
    userId: "u-zhao-heng",
    roleId: "committer"
  });

  expect(next.users.find((user) => user.id === "u-zhao-heng")?.roleId).toBe("committer");
  expect(next.auditEvents[0].kind).toBe("user-role-change");
  expect(next.auditEvents[0].userId).toBe("u-zhao-heng");
  expect(next.auditEvents[0].metadata?.previousRole).toBe("guest");
  expect(next.auditEvents[0].metadata?.newRole).toBe("committer");
});
```

The add-user call should include `title`:

```ts
const added = appReducer(initialState, {
  type: "ADD_USER",
  name: "Demo Engineer",
  email: "demo@chargelab.cn",
  title: "Prototype User",
  roleId: "user"
});
```

- [ ] **Step 3: Run reducer tests and verify they fail**

Run:

```bash
npm test -- src/reducer.userPermissions.test.ts src/appReducer.parameterAdmin.test.ts
```

Expected: FAIL because `ADD_USER` does not accept `title`, existing seeded roles are legacy ids, and final-admin checks are not implemented.

- [ ] **Step 4: Update mock data user types and seeded users**

Modify the imports near the top of `src/mockData.ts`:

```ts
import type { PlatformRole, PlatformRoleId, UserAccount } from "@/domain/users/types";
import { migrateLegacyRoleId, platformRoles } from "@/domain/users/types";
```

Replace the local `Role`, `RoleCapability`, and `User` exports with aliases:

```ts
export type Role = PlatformRole;
export type RoleCapability = PlatformRole["permissions"][number];
export type User = UserAccount;
```

Replace `export const roles` with:

```ts
export const roles: Role[] = platformRoles;
```

Update the seeded `users` so every item has a platform role id, title, and lastActive:

```ts
export const users: User[] = [
  { id: "u-xu-yun", name: "Xu Yun", email: "xu@chargelab.cn", title: "Platform Owner", roleId: "admin", isActive: true, createdAt: "2024-11-02T09:30:00.000Z", lastActive: "刚刚" },
  { id: "u-zhao-heng", name: "Zhao Heng", email: "zhao@chargelab.cn", title: "Hardware Engineer", roleId: "guest", isActive: true, createdAt: "2025-01-14T03:12:00.000Z", lastActive: "2 小时前" },
  { id: "u-liu-min", name: "Liu Min", email: "liu@chargelab.cn", title: "Project Engineer", roleId: "user", isActive: true, createdAt: "2025-02-03T08:04:00.000Z", lastActive: "今天 09:12" },
  { id: "u-wang-jie", name: "Wang Jie", email: "wang@chargelab.cn", title: "Parameter Reviewer", roleId: "committer", isActive: true, createdAt: "2024-12-20T12:00:00.000Z", lastActive: "昨天" },
  { id: "u-chen-na", name: "Chen Na", email: "chen@chargelab.cn", title: "Project Engineer", roleId: "user", isActive: true, createdAt: "2025-03-10T10:00:00.000Z", lastActive: "今天 10:00" },
  { id: "u-li-peng", name: "Li Peng", email: "lipeng@chargelab.cn", title: "Hardware Viewer", roleId: "guest", isActive: true, createdAt: "2025-03-22T11:00:00.000Z", lastActive: "3 天前" },
  { id: "u-sun-mei", name: "Sun Mei", email: "sun@chargelab.cn", title: "Parameter Reviewer", roleId: "committer", isActive: true, createdAt: "2025-04-01T09:00:00.000Z", lastActive: "5 小时前" },
  { id: "u-tao-lin", name: "Tao Lin", email: "tao@chargelab.cn", title: "External Viewer", roleId: "guest", isActive: false, createdAt: "2025-04-15T14:00:00.000Z", lastActive: "停用" }
];
```

In `createPrototypeState`, set:

```ts
activeRoleId: "guest",
```

Keep `currentUserId: "u-xu-yun"` as the active account. This intentionally lets tests switch persona with `activeRoleId` while user management actions are performed by the current seeded Admin.

- [ ] **Step 5: Update `AppAction` user action types**

In `src/App.tsx`, import the role type:

```ts
import type { PlatformRoleId } from "@/domain/users/types";
import { canPerform } from "@/app/permissions";
```

Change the user action union:

```ts
| { type: "ASSIGN_USER_ROLE"; userId: string; roleId: PlatformRoleId }
| { type: "TOGGLE_USER_ACTIVE"; userId: string; isActive: boolean }
| { type: "ADD_USER"; name: string; email: string; title: string; roleId: PlatformRoleId }
```

- [ ] **Step 6: Add reducer helper functions**

Place these helpers above `export function reducer` in `src/App.tsx`:

```ts
function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function canManageUsers(state: PrototypeState) {
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  return Boolean(currentUser?.isActive) && canPerform(currentUser?.roleId ?? "guest", "users.manage");
}

function wouldHaveActiveAdmin(state: PrototypeState, nextUsers: User[]) {
  return nextUsers.some((user) => user.isActive && user.roleId === "admin");
}
```

- [ ] **Step 7: Tighten reducer user cases**

Replace the existing `ASSIGN_USER_ROLE`, `TOGGLE_USER_ACTIVE`, and `ADD_USER` cases with:

```ts
case "ASSIGN_USER_ROLE": {
  if (!canManageUsers(state)) {
    return state;
  }
  if (action.userId === state.currentUserId && action.roleId !== "admin") {
    return state;
  }

  const user = state.users.find((item) => item.id === action.userId);
  if (!user || user.roleId === action.roleId || !roles.some((role) => role.id === action.roleId)) {
    return state;
  }

  const nextUsers = state.users.map((item) => (item.id === user.id ? { ...item, roleId: action.roleId } : item));
  if (!wouldHaveActiveAdmin(state, nextUsers)) {
    return state;
  }

  const auditEvent = buildAuditEvent("user-role-change", auditActor, `${user.name} role changed from ${user.roleId} to ${action.roleId}`, {
    userId: user.id,
    metadata: { previousRole: user.roleId, newRole: action.roleId }
  });

  return {
    ...state,
    users: nextUsers,
    auditEvents: [auditEvent, ...state.auditEvents]
  };
}
case "TOGGLE_USER_ACTIVE": {
  if (!canManageUsers(state)) {
    return state;
  }
  if (action.userId === state.currentUserId && !action.isActive) {
    return state;
  }

  const user = state.users.find((item) => item.id === action.userId);
  if (!user || user.isActive === action.isActive) {
    return state;
  }

  const nextUsers = state.users.map((item) => (item.id === user.id ? { ...item, isActive: action.isActive } : item));
  if (!wouldHaveActiveAdmin(state, nextUsers)) {
    return state;
  }

  const auditEvent = buildAuditEvent("user-toggle", auditActor, `${action.isActive ? "Enabled" : "Disabled"} user ${user.name}`, {
    userId: user.id,
    metadata: { isActive: action.isActive }
  });

  return {
    ...state,
    users: nextUsers,
    auditEvents: [auditEvent, ...state.auditEvents]
  };
}
case "ADD_USER": {
  if (!canManageUsers(state)) {
    return state;
  }

  const email = action.email.trim().toLowerCase();
  const name = action.name.trim();
  if (!name || !isValidEmail(email) || state.users.some((user) => user.email.toLowerCase() === email)) {
    return state;
  }

  const role = roles.find((item) => item.id === action.roleId);
  if (!role) {
    return state;
  }

  const newUser: User = {
    id: `user-${state.users.length + 1}`,
    name,
    email,
    title: action.title.trim() || "Platform user",
    roleId: action.roleId,
    isActive: true,
    createdAt: new Date().toISOString(),
    lastActive: "刚刚"
  };
  const auditEvent = buildAuditEvent("user-add", auditActor, `Added user ${newUser.name} (${role.name})`, {
    userId: newUser.id
  });

  return {
    ...state,
    users: [...state.users, newUser],
    auditEvents: [auditEvent, ...state.auditEvents]
  };
}
```

- [ ] **Step 8: Run reducer tests and verify they pass**

Run:

```bash
npm test -- src/reducer.userPermissions.test.ts src/appReducer.parameterAdmin.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/mockData.ts src/App.tsx src/appReducer.parameterAdmin.test.ts src/reducer.userPermissions.test.ts
git commit -m "feat: migrate users to platform roles"
```

---

### Task 4: Route Configuration And Sidebar Permission Filtering

**Files:**
- Modify: `src/appConfig.ts`
- Modify: `src/appConfig.test.ts`
- Modify: `src/App.tsx`
- Create: `src/permissionRouting.test.tsx`

- [ ] **Step 1: Add failing app config tests**

Append to `src/appConfig.test.ts`:

```ts
it("resolves the shared user permissions route outside the main navigation map", () => {
  const page = getPageByPath("/user-permissions");

  expect(page.key).toBe("user-permissions");
  expect(page.path).toBe("/user-permissions");
  expect(navigationItems.map((item) => item.path)).not.toContain("/user-permissions");
});

it("makes system settings a utility route to user permissions", () => {
  const systemSettings = utilityItems.find((item) => item.label.includes("系统设置"));

  expect(systemSettings?.path).toBe("/user-permissions");
});
```

Update the import to include `utilityItems`:

```ts
import { createAgentPlan, getPageByPath, navigationItems, utilityItems } from "./appConfig";
```

- [ ] **Step 2: Add failing routing tests for sidebar filtering**

Create `src/permissionRouting.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App, { appReducer } from "./App";
import { initialState } from "./mockData";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("permission-aware routing", () => {
  it("hides admin and operational navigation for Guest", () => {
    window.history.replaceState(null, "", "/parameter-home");

    render(<App />);

    expect(screen.getByRole("button", { name: /参数修改|鍙傛暟淇敼/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /参数审阅|鍙傛暟瀹￠槄/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /参数调试|鍙傛暟璋冭瘯/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /系统设置|绯荤粺璁剧疆/ })).not.toBeInTheDocument();
  });

  it("lets Admin see the shared user permissions utility entry", () => {
    const adminState = { ...initialState, activeRoleId: "admin" };
    expect(adminState.activeRoleId).toBe("admin");
  });

  it("prevents Guest from mutating parameter values in the reducer", () => {
    const next = appReducer(initialState, {
      type: "ADD_PARAMETER_SUBMISSION_ROUND",
      items: [{ parameterId: initialState.parameters[0].id, targetValue: "123", reason: "guest attempt" }]
    });

    expect(next).toBe(initialState);
  });
});
```

The second test is intentionally a lightweight state assertion at this stage; Task 5 adds route-level rendering once `PermissionDeniedPage` and the new page exist.

- [ ] **Step 3: Run config and routing tests and verify they fail**

Run:

```bash
npm test -- src/appConfig.test.ts src/permissionRouting.test.tsx
```

Expected: FAIL because `user-permissions` is not in `PageKey`, utility items do not have paths, sidebar is not role-aware, and reducer mutation guards do not exist.

- [ ] **Step 4: Update app config**

In `src/appConfig.ts`, add `Settings2` page support without adding the page to `navigationItems`.

Add to `PageKey`:

```ts
| "user-permissions"
```

Change `utilityItems` to:

```ts
export const utilityItems = [
  { label: "Agent 能力", icon: Bot },
  { label: "系统设置", icon: Settings2, path: "/user-permissions" }
];
```

Add this branch at the start of `getPageByPath` after the `/parameter-submissions` branch or before the final return:

```ts
if (path === "/user-permissions") {
  return {
    key: "user-permissions",
    path: "/user-permissions",
    label: "用户权限",
    group: "平台总览",
    icon: Settings2,
    title: "用户权限管理",
    subtitle: "统一管理 WiseEff 平台用户、四档角色和访问权限"
  };
}
```

- [ ] **Step 5: Make Sidebar role-aware**

In `src/App.tsx`, import:

```ts
import { canAccessPage } from "@/app/permissions";
import { migrateLegacyRoleId } from "@/domain/users/types";
```

In `AppShell`, derive the role:

```ts
const currentRoleId = migrateLegacyRoleId(state.activeRoleId);
```

Change the Sidebar call:

```tsx
<Sidebar activePath={page.path} currentRoleId={currentRoleId} onNavigate={navigate} />
```

Change the Sidebar signature:

```tsx
function Sidebar({
  activePath,
  currentRoleId,
  onNavigate
}: {
  activePath: string;
  currentRoleId: string;
  onNavigate: (path: string) => void;
}) {
```

Filter groups:

```ts
const visibleNavigationItems = navigationItems.filter((item) => canAccessPage(currentRoleId, item.key));
const groups = visibleNavigationItems.reduce<Record<string, PageConfig[]>>((acc, item) => {
  acc[item.group] = [...(acc[item.group] ?? []), item];
  return acc;
}, {});
```

Replace utility item rendering with:

```tsx
{utilityItems
  .filter((item) => !item.path || canAccessPage(currentRoleId, getPageByPath(item.path).key))
  .map((item) => {
    const Icon = item.icon;
    const button = (
      <Button
        className={item.path === activePath ? "nav-item compact active" : "nav-item compact"}
        type="button"
        variant="ghost"
        onClick={() => item.path && onNavigate(item.path)}
      >
        <Icon size={18} />
        <span>{item.label}</span>
      </Button>
    );

    return (
      <Tooltip key={item.label}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  })}
```

- [ ] **Step 6: Add reducer mutation guards for existing key actions**

At the top of `reducer`, after `auditActor`, derive:

```ts
const activeRoleId = migrateLegacyRoleId(state.activeRoleId);
```

Add guards at the start of these cases:

```ts
case "ADD_CHANGE_REQUEST":
case "ADD_PARAMETER_SUBMISSION_ROUND":
case "STASH_PARAMETER_SUBMISSION_ROUND":
  if (!canPerform(activeRoleId, "parameter.edit")) return state;
  // keep existing case body

case "ADVANCE_REVIEW":
case "REJECT_REVIEW":
case "TRANSFER_REVIEW":
case "UNDO_REVIEW_ACTION":
  if (!canPerform(activeRoleId, "parameter.review")) return state;
  // keep existing case body

case "SIMULATE_LOG_UPLOAD":
  if (!canPerform(activeRoleId, "logs.upload")) return state;
  // keep existing case body

case "CONNECT_DEVICE":
case "PUSH_DEBUG_VALUE":
case "PUSH_DEBUG_VALUES":
case "UPDATE_DEBUG_PARAMETER":
  if (!canPerform(activeRoleId, "debugging.use")) return state;
  // keep existing case body

case "UPDATE_PROJECT_PARAMETER_METADATA":
case "UPDATE_PROJECT_PARAMETER_VALUE":
case "ADD_PROJECT_PARAMETER":
case "ADD_PROJECT_PARAMETER_FROM_DRAFT":
case "DELETE_PROJECT_PARAMETER":
case "ADD_DEBUG_PARAMETER":
case "DELETE_DEBUG_PARAMETER":
case "MARK_CONFIG_PERSISTED":
  if (!canPerform(activeRoleId, "admin.access")) return state;
  // keep existing case body
```

When a case already has logic, do not duplicate the case label. Insert the guard as the first statement inside the existing case block.

- [ ] **Step 7: Run tests and verify they pass**

Run:

```bash
npm test -- src/appConfig.test.ts src/permissionRouting.test.tsx src/app/permissions.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/appConfig.ts src/appConfig.test.ts src/App.tsx src/permissionRouting.test.tsx
git commit -m "feat: gate navigation by platform role"
```

---

### Task 5: Permission-Denied Route Guard And User Permissions Route

**Files:**
- Modify: `src/app/routes.tsx`
- Create: `src/UserPermissionsPage.tsx`
- Create: `src/UserPermissionsPage.test.tsx`
- Modify: `src/permissionRouting.test.tsx`

- [ ] **Step 1: Write failing route guard tests**

Append to `src/permissionRouting.test.tsx`:

```tsx
it("shows permission denied when Guest opens an Admin URL directly", () => {
  window.history.replaceState(null, "", "/log-admin");

  render(<App />);

  expect(screen.getByRole("heading", { name: "Permission denied" })).toBeInTheDocument();
  expect(screen.getByText(/Current role: Guest/)).toBeInTheDocument();
  expect(screen.getByText(/Required role: Admin/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Create failing UserPermissionsPage tests**

Create `src/UserPermissionsPage.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UserPermissionsPage } from "./UserPermissionsPage";
import { createPrototypeState } from "./mockData";

describe("UserPermissionsPage", () => {
  it("renders role summary and user rows", () => {
    render(<UserPermissionsPage state={{ ...createPrototypeState(), activeRoleId: "admin" }} dispatch={vi.fn()} onNavigate={vi.fn()} search="" />);

    expect(screen.getByRole("heading", { name: "User permissions" })).toBeInTheDocument();
    expect(screen.getByText("Guest")).toBeInTheDocument();
    expect(screen.getByText("Committer")).toBeInTheDocument();
    expect(screen.getByText("Xu Yun")).toBeInTheDocument();
  });

  it("dispatches add user with selected role", async () => {
    const dispatch = vi.fn();
    render(<UserPermissionsPage state={{ ...createPrototypeState(), activeRoleId: "admin" }} dispatch={dispatch} onNavigate={vi.fn()} search="" />);

    await userEvent.click(screen.getByRole("button", { name: "Add user" }));
    await userEvent.type(screen.getByLabelText("Name"), "New User");
    await userEvent.type(screen.getByLabelText("Email"), "new.user@chargelab.cn");
    await userEvent.type(screen.getByLabelText("Title"), "Debug Engineer");
    await userEvent.selectOptions(screen.getByLabelText("Initial role"), "user");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_USER",
      name: "New User",
      email: "new.user@chargelab.cn",
      title: "Debug Engineer",
      roleId: "user"
    });
  });

  it("dispatches role and status changes", async () => {
    const dispatch = vi.fn();
    const state = { ...createPrototypeState(), activeRoleId: "admin" };
    render(<UserPermissionsPage state={state} dispatch={dispatch} onNavigate={vi.fn()} search="" />);

    const row = screen.getByText("Liu Min").closest("tr")!;
    await userEvent.selectOptions(within(row).getByLabelText("Role for Liu Min"), "committer");
    await userEvent.click(within(row).getByRole("button", { name: "Disable Liu Min" }));

    expect(dispatch).toHaveBeenCalledWith({ type: "ASSIGN_USER_ROLE", userId: "u-liu-min", roleId: "committer" });
    expect(dispatch).toHaveBeenCalledWith({ type: "TOGGLE_USER_ACTIVE", userId: "u-liu-min", isActive: false });
  });
});
```

- [ ] **Step 3: Run route/page tests and verify they fail**

Run:

```bash
npm test -- src/permissionRouting.test.tsx src/UserPermissionsPage.test.tsx
```

Expected: FAIL because `UserPermissionsPage` and route guard are not implemented.

- [ ] **Step 4: Implement a focused UserPermissionsPage**

Create `src/UserPermissionsPage.tsx`:

```tsx
import { useMemo, useState, type FormEvent } from "react";
import type { AppAction } from "./App";
import { platformRoles, type PlatformRoleId } from "@/domain/users/types";
import type { PrototypeState } from "./mockData";

type UserPermissionsPageProps = {
  state: PrototypeState;
  dispatch: React.Dispatch<AppAction>;
  onNavigate: (path: string) => void;
  search: string;
};

const roleOptions = platformRoles.map((role) => ({ value: role.id, label: role.name }));

export function UserPermissionsPage({ state, dispatch }: UserPermissionsPageProps) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<PlatformRoleId | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [roleId, setRoleId] = useState<PlatformRoleId>("user");
  const [error, setError] = useState("");

  const normalizedQuery = query.trim().toLowerCase();
  const filteredUsers = useMemo(
    () =>
      state.users.filter((user) => {
        const matchesQuery =
          !normalizedQuery ||
          [user.name, user.email, user.title].some((value) => value.toLowerCase().includes(normalizedQuery));
        const matchesRole = roleFilter === "all" || user.roleId === roleFilter;
        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "active" && user.isActive) ||
          (statusFilter === "inactive" && !user.isActive);
        return matchesQuery && matchesRole && matchesStatus;
      }),
    [normalizedQuery, roleFilter, state.users, statusFilter]
  );

  const roleCounts = useMemo(
    () =>
      platformRoles.map((role) => ({
        role,
        count: state.users.filter((user) => user.roleId === role.id).length
      })),
    [state.users]
  );

  const submitAddUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required.");
      return;
    }
    dispatch({ type: "ADD_USER", name: name.trim(), email: email.trim(), title: title.trim(), roleId });
    setName("");
    setEmail("");
    setTitle("");
    setRoleId("user");
    setError("");
    setAddOpen(false);
  };

  return (
    <div className="user-permissions-page">
      <section className="user-permissions-summary" aria-label="Role summary">
        <div>
          <span className="eyebrow">System settings</span>
          <h2>User permissions</h2>
          <p>Manage WiseEff users, four platform roles, and access boundaries.</p>
        </div>
        <button className="button primary" type="button" onClick={() => setAddOpen(true)}>
          Add user
        </button>
      </section>

      <div className="user-permissions-grid">
        <aside className="user-permissions-panel">
          <label>
            <span>Search</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <label>
            <span>Role</span>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as PlatformRoleId | "all")}>
              <option value="all">All roles</option>
              {roleOptions.map((role) => (
                <option key={role.value} value={role.value}>{role.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="all">All users</option>
              <option value="active">Active</option>
              <option value="inactive">Disabled</option>
            </select>
          </label>
          <div className="user-permissions-counts">
            {roleCounts.map(({ role, count }) => (
              <div key={role.id}>
                <strong>{count}</strong>
                <span>{role.name}</span>
              </div>
            ))}
          </div>
        </aside>

        <section className="user-permissions-table-card" aria-label="Users">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Title</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last active</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className={!user.isActive ? "is-disabled" : undefined}>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td>{user.title}</td>
                  <td>
                    <select
                      aria-label={`Role for ${user.name}`}
                      value={user.roleId}
                      disabled={user.id === state.currentUserId}
                      onChange={(event) =>
                        dispatch({ type: "ASSIGN_USER_ROLE", userId: user.id, roleId: event.target.value as PlatformRoleId })
                      }
                    >
                      {roleOptions.map((role) => (
                        <option key={role.value} value={role.value}>{role.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>{user.isActive ? "Active" : "Disabled"}</td>
                  <td>{user.lastActive}</td>
                  <td>
                    <button
                      className="button subtle"
                      type="button"
                      disabled={user.id === state.currentUserId}
                      onClick={() => dispatch({ type: "TOGGLE_USER_ACTIVE", userId: user.id, isActive: !user.isActive })}
                    >
                      {user.isActive ? `Disable ${user.name}` : `Enable ${user.name}`}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <aside className="user-permissions-panel">
          <h3>Role capabilities</h3>
          {platformRoles.map((role) => (
            <article key={role.id} className="role-capability-card">
              <strong>{role.name}</strong>
              <p>{role.description}</p>
              <ul>
                {role.permissions.map((permission) => (
                  <li key={permission}>{permission}</li>
                ))}
              </ul>
            </article>
          ))}
        </aside>
      </div>

      {addOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-platform-user-title">
          <form className="confirm-dialog user-permissions-dialog" onSubmit={submitAddUser}>
            <h2 id="add-platform-user-title">Add user</h2>
            <label>
              <span>Name</span>
              <input aria-label="Name" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              <span>Email</span>
              <input aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              <span>Title</span>
              <input aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              <span>Initial role</span>
              <select aria-label="Initial role" value={roleId} onChange={(event) => setRoleId(event.target.value as PlatformRoleId)}>
                {roleOptions.map((role) => (
                  <option key={role.value} value={role.value}>{role.label}</option>
                ))}
              </select>
            </label>
            {error ? <p className="field-warning">{error}</p> : null}
            <div className="dialog-actions">
              <button className="button subtle" type="button" onClick={() => setAddOpen(false)}>Cancel</button>
              <button className="button primary" type="submit">Create user</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Add route guard and page route**

In `src/app/routes.tsx`, import:

```ts
import { canAccessPage, getAccessibleFallbackPath, getRequiredRoleForPage, getRequiredRoleLabel } from "@/app/permissions";
import { migrateLegacyRoleId } from "@/domain/users/types";
import { UserPermissionsPage } from "@/UserPermissionsPage";
```

At the top of `PageRouter`, before the switch:

```tsx
const currentRoleId = migrateLegacyRoleId(state.activeRoleId);
if (!canAccessPage(currentRoleId, page.key)) {
  const requiredRole = getRequiredRoleForPage(page.key);
  return (
    <section className="permission-denied-page" aria-label="Permission denied">
      <span className="eyebrow">Access control</span>
      <h2>Permission denied</h2>
      <p>Current role: {getRequiredRoleLabel(currentRoleId)}</p>
      <p>Required role: {getRequiredRoleLabel(requiredRole)}</p>
      <button className="button primary" type="button" onClick={() => onNavigate(getAccessibleFallbackPath(currentRoleId))}>
        Back to accessible workspace
      </button>
    </section>
  );
}
```

Add this switch case:

```tsx
case "user-permissions":
  return <UserPermissionsPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
```

- [ ] **Step 6: Run route and page tests**

Run:

```bash
npm test -- src/permissionRouting.test.tsx src/UserPermissionsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/routes.tsx src/UserPermissionsPage.tsx src/UserPermissionsPage.test.tsx src/permissionRouting.test.tsx
git commit -m "feat: add shared user permissions page"
```

---

### Task 6: Guest Read-Only Parameter Workspace

**Files:**
- Modify: `src/ParametersPage.tsx`
- Modify: `src/components/ParametersTable.tsx`
- Modify: `src/ParametersPage.test.tsx`
- Modify: `src/app/routes.tsx`

- [ ] **Step 1: Write failing read-only tests**

Append to `src/ParametersPage.test.tsx`:

```tsx
it("renders Guest workspace as read-only", () => {
  const state = { ...initialState, activeRoleId: "guest" };
  render(
    <TopBarActionsHarness>
      <ParametersPage state={state} dispatch={vi.fn()} onNavigate={vi.fn()} search="" canEdit={false} />
    </TopBarActionsHarness>
  );

  expect(screen.getByText("Read-only access")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /编辑|缂栬緫/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /提交本轮|鎻愪氦鏈疆/ })).toBeDisabled();
});
```

If the local test harness does not export `TopBarActionsHarness`, add a small provider wrapper in the test file using the same pattern as `LogAdminPage.test.tsx`.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- src/ParametersPage.test.tsx
```

Expected: FAIL because `ParametersPage` does not accept `canEdit`.

- [ ] **Step 3: Add read-only props to ParametersPage**

In `src/ParametersPage.tsx`, update props:

```ts
type ParametersPageProps = {
  state: PrototypeState;
  dispatch: Dispatch<ParametersPageAction>;
  onNavigate: (path: string) => void;
  search: string;
  canEdit?: boolean;
};
```

Change the component signature:

```tsx
export function ParametersPage({ state, dispatch, onNavigate, search, canEdit = true }: ParametersPageProps) {
```

In `handleEditRow`, add:

```ts
if (!canEdit) {
  return;
}
```

In `handleSelectedIdsChange`, `openSubmitPreview`, `submitParameterToModifiedTable`, `submitRound`, `stashRound`, and `addInsightItemsToDraft`, add this first statement:

```ts
if (!canEdit) {
  return;
}
```

Render a read-only note immediately inside `parameters-page-layout`:

```tsx
{!canEdit ? (
  <div className="permission-inline-note" role="status">
    <strong>Read-only access</strong>
    <span>Requires User role to edit, draft, or submit parameter changes.</span>
  </div>
) : null}
```

Pass `canEdit` to both `ParametersTable` instances:

```tsx
canEdit={canEdit}
```

Disable bottom actions:

```tsx
<button className="button subtle" type="button" disabled={!canEdit || pendingSubmissionItems.length === 0} onClick={stashRound}>
```

```tsx
<button className="button primary" type="button" disabled={!canEdit || !allSelectedDraftsHaveTargets} onClick={openSubmitPreview}>
```

Only render `WorkbenchSheet` when editable:

```tsx
{canEdit && draftItems.length > 0 && sheetOpen ? (
```

- [ ] **Step 4: Add read-only support to ParametersTable**

In `src/components/ParametersTable.tsx`, add prop:

```ts
canEdit?: boolean;
```

In the destructuring:

```ts
canEdit = true,
```

Only render edit buttons when editable:

```tsx
{canEdit ? (
  <button
    type="button"
    className="edit-row-button"
    aria-label={`编辑 ${row.name}`}
    onClick={(event) => {
      event.stopPropagation();
      onEditRow?.(row.id);
    }}
  >
    <Pencil size={15} />
  </button>
) : (
  <span className="permission-muted-action" title="Requires User role">Read only</span>
)}
```

Disable checkbox controls when read-only:

```tsx
disabled={!canEdit || !hasModifiedVisible}
```

and row checkboxes:

```tsx
disabled={!canEdit}
```

- [ ] **Step 5: Pass `canEdit` from PageRouter**

In `src/app/routes.tsx`, import `canPerform` if not already imported. In the `"parameters"` case:

```tsx
return (
  <UserParametersPage
    state={state}
    dispatch={dispatch}
    onNavigate={onNavigate}
    search={search}
    canEdit={canPerform(currentRoleId, "parameter.edit")}
  />
);
```

- [ ] **Step 6: Run parameter tests**

Run:

```bash
npm test -- src/ParametersPage.test.tsx src/permissionRouting.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ParametersPage.tsx src/components/ParametersTable.tsx src/ParametersPage.test.tsx src/app/routes.tsx
git commit -m "feat: make guest parameters read only"
```

---

### Task 7: Admin Backend Permission Affordance Migration

**Files:**
- Modify: `src/LogAdminPage.tsx`
- Modify: `src/LogAdminPage.test.tsx`
- Modify: `src/ParameterAdminPage.tsx`
- Modify: `src/workspaceHeaderIntegration.test.tsx`
- Optional delete after tests pass: `src/components/admin/AccessControlPanel.tsx`, `src/components/admin/AccessControlPanel.test.tsx`, `src/components/admin/AddUserDialog.tsx`, `src/components/admin/AddUserDialog.test.tsx`
- Modify if deleting: `src/components/admin/index.ts`

- [ ] **Step 1: Write failing log-admin migration tests**

In `src/LogAdminPage.test.tsx`, replace the `LogAdminPage · access control` describe block with:

```tsx
describe("LogAdminPage · shared permissions entry", () => {
  it("links to the shared user permissions page instead of editing users locally", async () => {
    const state = createPrototypeState();
    const adminState = { ...state, activeRoleId: "admin" };
    const onNavigate = vi.fn();
    render(
      <TopBarActionsHarness>
        <LogAdminPage state={adminState} dispatch={vi.fn()} onNavigate={onNavigate} search="" />
      </TopBarActionsHarness>
    );

    expect(screen.queryByText("Jane Smith")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Manage user permissions" }));

    expect(onNavigate).toHaveBeenCalledWith("/user-permissions");
  });
});
```

- [ ] **Step 2: Update parameter-admin topbar expectation**

In `src/workspaceHeaderIntegration.test.tsx`, after the existing permissions button expectation, add:

```ts
expect(within(topbarActions).getByRole("button", { name: "权限" })).toHaveAttribute("data-route", "/user-permissions");
```

- [ ] **Step 3: Run migration tests and verify they fail**

Run:

```bash
npm test -- src/LogAdminPage.test.tsx src/workspaceHeaderIntegration.test.tsx
```

Expected: FAIL because log-admin still renders `AccessControlPanel` and parameter admin permission button does not navigate.

- [ ] **Step 4: Remove log-admin private user editing**

In `src/LogAdminPage.tsx`, remove imports for `AccessControlPanel` and `AddUserDialog`.

Remove state:

```ts
const [addUserOpen, setAddUserOpen] = useState(false);
```

Remove the `<AccessControlPanel ... />` block and `<AddUserDialog ... />`.

Replace with:

```tsx
<section className="shared-permissions-entry">
  <div>
    <h3>Shared user permissions</h3>
    <p>User roles are managed once for the whole WiseEff platform.</p>
  </div>
  <Button variant="outline" onClick={() => onNavigate("/user-permissions")}>
    Manage user permissions
  </Button>
</section>
```

Remove `canManage` if it is no longer used. Keep `canAct` for drawer action gating.

- [ ] **Step 5: Make parameter admin permissions button navigate**

In `src/ParameterAdminPage.tsx`, change the function signature if `onNavigate` is not destructured:

```tsx
export function ParameterAdminPage({ state, dispatch, onNavigate, search: rawSearch }: PageProps) {
```

Replace the permissions button with:

```tsx
<button className="button subtle" type="button" data-route="/user-permissions" onClick={() => onNavigate("/user-permissions")}>
  <ShieldCheck size={16} />
  权限
</button>
```

- [ ] **Step 6: Delete unused local permission components if no imports remain**

Run:

```bash
rg -n "AccessControlPanel|AddUserDialog" src
```

If the only hits are the component files and their tests, delete:

```bash
git rm src/components/admin/AccessControlPanel.tsx src/components/admin/AccessControlPanel.test.tsx src/components/admin/AddUserDialog.tsx src/components/admin/AddUserDialog.test.tsx
```

Then remove these exports from `src/components/admin/index.ts`:

```ts
export { AccessControlPanel } from "./AccessControlPanel";
export type { AccessControlPanelProps } from "./AccessControlPanel";
export { AddUserDialog } from "./AddUserDialog";
```

- [ ] **Step 7: Run migration tests**

Run:

```bash
npm test -- src/LogAdminPage.test.tsx src/workspaceHeaderIntegration.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/LogAdminPage.tsx src/LogAdminPage.test.tsx src/ParameterAdminPage.tsx src/workspaceHeaderIntegration.test.tsx src/components/admin/index.ts
git add -u src/components/admin
git commit -m "refactor: route admin permission affordances to shared page"
```

---

### Task 8: User Permissions Styling And Permission-Denied Polish

**Files:**
- Modify: `src/styles.css`
- Modify: `src/UserPermissionsPage.test.tsx`
- Modify: `src/permissionRouting.test.tsx`

- [ ] **Step 1: Add CSS contract tests**

Append to `src/UserPermissionsPage.test.tsx`:

```tsx
it("uses the operational permissions layout classes", () => {
  render(<UserPermissionsPage state={{ ...createPrototypeState(), activeRoleId: "admin" }} dispatch={vi.fn()} onNavigate={vi.fn()} search="" />);

  expect(document.querySelector(".user-permissions-page")).toBeInTheDocument();
  expect(document.querySelector(".user-permissions-grid")).toBeInTheDocument();
  expect(document.querySelector(".user-permissions-table-card")).toBeInTheDocument();
});
```

Append to `src/permissionRouting.test.tsx`:

```tsx
it("uses a stable permission denied layout", () => {
  window.history.replaceState(null, "", "/debugging-admin");

  render(<App />);

  expect(document.querySelector(".permission-denied-page")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify they fail only on CSS selectors if previous tasks passed**

Run:

```bash
npm test -- src/UserPermissionsPage.test.tsx src/permissionRouting.test.tsx
```

Expected: FAIL if classes were not added yet; PASS if component classes already exist. Continue to CSS either way.

- [ ] **Step 3: Add CSS**

Append to `src/styles.css` near other admin page styles:

```css
.permission-denied-page,
.user-permissions-page {
  padding: 24px;
}

.permission-denied-page {
  display: grid;
  gap: 12px;
  max-width: 560px;
  margin: 48px auto;
  border: 1px solid var(--outline);
  border-radius: 12px;
  background: var(--surface);
}

.permission-inline-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--outline);
  border-radius: 8px;
  background: #f8fafc;
  padding: 10px 12px;
  color: var(--text-muted);
}

.permission-inline-note strong {
  color: var(--text);
}

.permission-muted-action {
  color: var(--text-muted);
  font-size: 12px;
}

.user-permissions-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.user-permissions-summary,
.user-permissions-panel,
.user-permissions-table-card,
.shared-permissions-entry {
  border: 1px solid var(--outline);
  border-radius: 12px;
  background: var(--surface);
}

.user-permissions-summary,
.shared-permissions-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
}

.user-permissions-summary h2,
.shared-permissions-entry h3 {
  margin: 0;
}

.user-permissions-grid {
  display: grid;
  grid-template-columns: 260px minmax(520px, 1fr) 300px;
  gap: 16px;
  align-items: start;
}

.user-permissions-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}

.user-permissions-panel label,
.user-permissions-dialog label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.user-permissions-panel input,
.user-permissions-panel select,
.user-permissions-dialog input,
.user-permissions-dialog select,
.user-permissions-table-card select {
  height: 32px;
  border: 1px solid var(--outline);
  border-radius: 6px;
  background: #fff;
  padding: 0 8px;
  color: var(--text);
}

.user-permissions-counts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.user-permissions-counts div,
.role-capability-card {
  border: 1px solid var(--outline);
  border-radius: 8px;
  padding: 10px;
  background: #f8fafc;
}

.user-permissions-counts strong {
  display: block;
  font-size: 20px;
}

.user-permissions-table-card {
  overflow: hidden;
}

.user-permissions-table-card table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.user-permissions-table-card th,
.user-permissions-table-card td {
  border-bottom: 1px solid var(--outline);
  padding: 10px;
  text-align: left;
}

.user-permissions-table-card tr.is-disabled {
  color: var(--text-muted);
  background: #f8fafc;
}

.user-permissions-dialog {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (max-width: 1200px) {
  .user-permissions-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Run CSS-adjacent tests**

Run:

```bash
npm test -- src/UserPermissionsPage.test.tsx src/permissionRouting.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/styles.css src/UserPermissionsPage.test.tsx src/permissionRouting.test.tsx
git commit -m "style: polish user permissions layouts"
```

---

### Task 9: Full Permission Regression Coverage

**Files:**
- Modify: `src/permissionRouting.test.tsx`
- Modify: `src/logAdminAnalytics.test.ts`
- Modify: `src/logAdminAnalytics.ts`

- [ ] **Step 1: Replace log-admin role derivation with platform policy tests**

In `src/logAdminAnalytics.test.ts`, replace the `deriveLogAdminRole` describe block with:

```ts
describe("log admin role policy compatibility", () => {
  it("uses Admin-only page access for log admin", () => {
    expect(canAccessPage("admin", "log-admin")).toBe(true);
    expect(canAccessPage("committer", "log-admin")).toBe(false);
    expect(canAccessPage("user", "log-admin")).toBe(false);
    expect(canAccessPage("guest", "log-admin")).toBe(false);
  });
});
```

Add the import:

```ts
import { canAccessPage } from "./app/permissions";
```

- [ ] **Step 2: Remove old log-admin role helper**

In `src/logAdminAnalytics.ts`, remove `LogAdminRole` from the import and delete `deriveLogAdminRole`. In `src/LogAdminPage.tsx`, remove the `deriveLogAdminRole` import and replace:

```ts
const role = deriveLogAdminRole(state.activeRoleId);
const canAct = role !== "Viewer";
```

with:

```ts
const canAct = canPerform(state.activeRoleId, "admin.access");
```

Import:

```ts
import { canPerform } from "@/app/permissions";
```

- [ ] **Step 3: Add route matrix tests**

Append to `src/permissionRouting.test.tsx`:

```tsx
describe("permission route matrix", () => {
  it("keeps User out of review and admin pages", () => {
    expect(canAccessPage("user", "parameter-review")).toBe(false);
    expect(canAccessPage("user", "parameter-admin")).toBe(false);
    expect(canAccessPage("user", "logs")).toBe(true);
    expect(canAccessPage("user", "debugging")).toBe(true);
  });

  it("keeps Committer out of admin pages while allowing review", () => {
    expect(canAccessPage("committer", "parameter-review")).toBe(true);
    expect(canAccessPage("committer", "debugging-admin")).toBe(false);
    expect(canAccessPage("committer", "user-permissions")).toBe(false);
  });
});
```

Add the import:

```ts
import { canAccessPage } from "./app/permissions";
```

- [ ] **Step 4: Run the regression tests**

Run:

```bash
npm test -- src/permissionRouting.test.tsx src/logAdminAnalytics.test.ts src/LogAdminPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/permissionRouting.test.tsx src/logAdminAnalytics.test.ts src/logAdminAnalytics.ts src/LogAdminPage.tsx src/LogAdminPage.test.tsx
git commit -m "refactor: remove log admin private roles"
```

---

### Task 10: App-Wide Verification And Browser QA

**Files:**
- No planned source edits. Fix only defects discovered by verification.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS with all test files passing. If a permission assertion fails, fix the narrow policy or test expectation causing the mismatch, then rerun `npm test`.

- [ ] **Step 2: Run the production build**

Run:

```bash
npm run build
```

Expected: PASS. The existing Vite large chunk warning is acceptable.

- [ ] **Step 3: Start or reuse the dev server**

If no dev server is running:

```bash
npm run dev
```

Expected: Vite reports a local URL, usually `http://127.0.0.1:5173/`.

- [ ] **Step 4: Browser-check Admin permissions page**

Open:

```text
http://127.0.0.1:5173/user-permissions
```

Expected:

- The page renders `User permissions`.
- The user table includes `Xu Yun`.
- The role capability panel includes `Guest`, `User`, `Committer`, and `Admin`.
- The Add user dialog opens.
- Changing a non-current user role updates the table after reducer state changes.

- [ ] **Step 5: Browser-check direct URL denial**

With the default Guest role, open:

```text
http://127.0.0.1:5173/log-admin
```

Expected:

- The page renders `Permission denied`.
- It shows `Current role: Guest`.
- It shows `Required role: Admin`.
- The fallback button returns to `/parameter-home`.

- [ ] **Step 6: Browser-check Guest read-only parameters**

Open:

```text
http://127.0.0.1:5173/parameters
```

Expected:

- Parameter rows render.
- The read-only notice is visible.
- Edit buttons do not open the draft sheet.
- Submit buttons are disabled.

- [ ] **Step 7: Commit verification fixes if any**

If verification required source changes:

```bash
git add <changed-files>
git commit -m "fix: harden user permission enforcement"
```

If no source changes were needed, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Shared `/user-permissions` page: Task 5 and Task 8.
- Sidebar `系统设置` entry: Task 4.
- Four roles with standard `Committer` spelling: Task 1.
- Real permission enforcement: Tasks 2, 4, 5, 6, 7, and 9.
- Mixed visibility strategy: Tasks 4, 5, and 6.
- Add, enable, disable, and role change without delete: Tasks 3 and 5.
- Legacy role migration: Task 1 and Task 3.
- Log-admin private model removal: Task 7 and Task 9.
- Parameter admin permission affordance routing: Task 7.
- Error handling for email, self-lockout, final admin, and unknown roles: Tasks 1 and 3.
- Unit and integration testing: all tasks include red-green verification.

Red-flag scan:

- No deferred requirements remain in this plan.
- Every code-changing task includes a test-first step, an implementation step with concrete code or exact insertion snippets, a verification command, and a commit command.
- Type names are consistent across tasks: `PlatformRoleId`, `PermissionKey`, `UserAccount`, `ActionKey`, `canAccessPage`, `canPerform`, and `/user-permissions`.
