# User Permissions Design

Date: 2026-05-17
Status: Approved for implementation planning

## Goal

Build a shared user permissions management page for WiseEff. The page should replace app-specific permission editing with one platform-level role system and make those permissions affect navigation, direct URL access, and important page actions.

## Product Decisions

- Add a new platform page at `/user-permissions`.
- Surface it from the sidebar utility area through `系统设置`.
- Use four platform roles: `Guest`, `User`, `Committer`, and `Admin`.
- Enforce permissions in the real UI, not just in the management page.
- Use a mixed visibility strategy:
  - Hide inaccessible pages from the sidebar.
  - Show a permission-denied page for direct URL access.
  - Keep important in-page actions visible but disabled with a reason.
- Manage user lifecycle with add, enable, disable, and role change.
- Do not delete users in this iteration.

## Roles

| Role | Permissions |
| --- | --- |
| Guest | Can view parameter pages only: parameter homepage, read-only parameter workspace, and parameter comparison. |
| User | Guest permissions plus parameter editing, parameter debugging, node debugging, and log upload for intelligent analysis. |
| Committer | User permissions plus parameter review. |
| Admin | Committer permissions plus access to all application admin pages and the shared user permissions page. |

The role name should use the standard spelling `Committer`.

## Existing Model Migration

The current codebase has platform roles and a separate log-admin role model. The implementation should collapse these into the platform role model.

Legacy platform role mapping:

| Existing role id | New role id |
| --- | --- |
| `hardware` | `guest` |
| `project` | `user` |
| `parameter-admin` | `committer` |
| `admin` | `admin` |

The current log-admin `Admin / Editor / Viewer` model should stop being a separate user-management system. Log admin may link to the shared permissions page, but editing user roles should happen only at `/user-permissions`.

## Domain Model

Create or extend the user domain around platform roles:

- `PlatformRoleId = "guest" | "user" | "committer" | "admin"`
- `PermissionKey` for user-visible capabilities, such as:
  - `parameter:view`
  - `parameter:edit`
  - `debugging:use`
  - `logs:upload`
  - `parameter:review`
  - `admin:access`
  - `users:manage`
- `UserAccount` for users displayed and managed by the new page.

The role definitions should be data-driven so the page can render the role matrix from the same source that powers permission checks.

## Permission Policy

Centralize permission checks in a policy module instead of scattering role comparisons through pages.

Recommended API:

- `canAccessPage(roleId, pageKey)`
- `canPerform(roleId, actionKey)`
- `getRequiredRoleForPage(pageKey)`
- `getRequiredRoleForAction(actionKey)`

Expected page access:

| Page group | Guest | User | Committer | Admin |
| --- | --- | --- | --- | --- |
| Home | Yes | Yes | Yes | Yes |
| Parameter homepage | Yes | Yes | Yes | Yes |
| Parameter workspace | Read-only | Yes | Yes | Yes |
| Parameter comparison | Yes | Yes | Yes | Yes |
| Parameter review | No | No | Yes | Yes |
| Parameter admin | No | No | No | Yes |
| Debugging pages | No | Yes | Yes | Yes |
| Log dashboard and analysis | No | Yes | Yes | Yes |
| Log admin | No | No | No | Yes |
| Debugging admin | No | No | No | Yes |
| User permissions | No | No | No | Yes |

## Page Design

`/user-permissions` should feel like an operational admin page, not a marketing page.

Layout:

- Left panel: search, status filter, role filter, and role counts.
- Main panel: user table/list with name, email, title, role, status, last activity, and quick actions.
- Right panel: role capability matrix explaining what each role can do.

Core actions:

- Add user with name, email, title, and initial role.
- Change role with a select control.
- Disable or enable users with a clear status indicator.
- Prevent disabling the current user.
- Prevent the current user from downgrading themselves below `Admin`.

No hard delete in this iteration.

## Navigation And Page Behavior

Navigation:

- Filter sidebar items through the centralized policy.
- `系统设置` should navigate to `/user-permissions` for Admin users.
- Non-Admin users should not see the user permissions entry.

Direct URL handling:

- If the current role cannot access a route, render a permission-denied state.
- The denied state should show:
  - current role
  - required minimum role
  - a safe navigation target back to an accessible page

In-page action handling:

- Guest can open parameter workspace but cannot edit, draft, or submit changes.
- User can edit parameters, debug parameters/nodes, and upload logs.
- User cannot approve/reject/review parameter submissions.
- Committer can review parameter submissions.
- Admin can access all admin pages and manage users.

Reducer handling:

- Mutating permission actions should no-op when the actor lacks permission.
- Permission changes should create audit events.
- Invalid self-lockout actions should no-op and surface a notification.

## Error Handling

- Empty user name or invalid email should block add-user submission.
- Unknown role ids should be treated as the lowest privilege role for access checks.
- If there is no Admin user left after a proposed change, block it.
- Permission-denied pages should not throw or redirect-loop.

## Testing

Unit tests:

- Role-to-permission matrix.
- `canAccessPage` for all page groups.
- `canPerform` for important action keys.
- Legacy role migration.
- Reducer cases for add user, enable/disable user, role changes, self-downgrade prevention, and no-final-admin prevention.

Integration tests:

- Sidebar changes by role.
- Direct URL access renders permission denied for insufficient roles.
- Guest gets a read-only parameter workspace.
- User can access debugging and log upload but not parameter review.
- Committer can access parameter review but not admin pages.
- Admin can access all admin pages and `/user-permissions`.
- Parameter admin and log admin permission affordances route to the shared permissions page instead of app-local permission editors.

## Out Of Scope

- Real login or identity provider integration.
- Backend persistence.
- Server-side authorization.
- SSO, groups, teams, or project-scoped permissions.
- Deleting users.
- Custom roles beyond the four approved roles.
