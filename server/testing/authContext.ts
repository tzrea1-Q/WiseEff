import { permissionsForRoles } from "../modules/auth/policy";
import type {
  AuthContext,
  BackendPermission,
  BackendRoleId,
  RoleBinding
} from "../modules/auth/types";

export type TestAuthContextOverrides = {
  userId?: string;
  organizationId?: string;
  name?: string;
  email?: string;
  title?: string;
  isActive?: boolean;
  organizationName?: string;
  /** Full role bindings. Defaults to a single org-wide binding for `roleId`. */
  roles?: RoleBinding[];
  /** Convenience for the common single org-wide role case. Defaults to "admin". */
  roleId?: BackendRoleId;
  /**
   * Explicit permission list. Defaults to `permissionsForRoles` over the bound roles so
   * fixtures track the production RBAC policy instead of hand-copied arrays. Accepts
   * plain strings so suites probing unknown-permission edges can keep their literals.
   */
  permissions?: readonly (BackendPermission | (string & {}))[];
};

/**
 * Build an `AuthContext` for tests. Identity fields stay per-suite (they are wired into the
 * suite's seeded rows); role-derived permissions come from the real policy by default.
 */
export function makeTestAuthContext(overrides: TestAuthContextOverrides = {}): AuthContext {
  const organizationId = overrides.organizationId ?? "org-test";
  const userId = overrides.userId ?? "user-test";
  const roles: RoleBinding[] = overrides.roles ?? [
    { projectId: null, roleId: overrides.roleId ?? "admin" }
  ];
  const permissions = (overrides.permissions ??
    permissionsForRoles(roles.map((binding) => binding.roleId))) as BackendPermission[];

  return {
    user: {
      id: userId,
      organizationId,
      name: overrides.name ?? "Test User",
      email: overrides.email ?? `${userId}@example.com`,
      title: overrides.title ?? "Admin",
      isActive: overrides.isActive ?? true
    },
    organization: {
      id: organizationId,
      name: overrides.organizationName ?? "Test Org"
    },
    roles,
    permissions: [...permissions]
  };
}
