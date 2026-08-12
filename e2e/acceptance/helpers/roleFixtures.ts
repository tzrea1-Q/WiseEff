import { withPgClient } from "./database";
import {
  ACCEPTANCE_ORGANIZATION,
  acceptanceCast,
  castByRole,
  type AcceptanceRoleId
} from "./cast";

const organizationId = ACCEPTANCE_ORGANIZATION.id;

/** Org-Admin-only actor for PERM-MATRIX (seed-m0 also binds platform-admin on u-xu-yun). */
export const acceptanceAdminOnlyUser = {
  userId: acceptanceCast.acceptanceAdmin.userId,
  name: acceptanceCast.acceptanceAdmin.name,
  email: acceptanceCast.acceptanceAdmin.email
} as const;

/**
 * One org-wide binding per role. Sign-in users come from the shared cast; the admin
 * binding deliberately uses the synthetic admin-only actor instead of the cast's
 * default admin (u-xu-yun) so PERM-MATRIX can separate org-admin from platform-admin.
 */
const acceptanceRoleBindings: ReadonlyArray<{
  bindingId: string;
  userId: string;
  roleId: AcceptanceRoleId;
}> = [
  { bindingId: "acceptance-role-guest-binding", userId: castByRole.guest.userId, roleId: "guest" },
  {
    bindingId: "acceptance-role-hardware-user-binding",
    userId: castByRole["hardware-user"].userId,
    roleId: "hardware-user"
  },
  {
    bindingId: "acceptance-role-software-user-binding",
    userId: castByRole["software-user"].userId,
    roleId: "software-user"
  },
  {
    bindingId: "acceptance-role-hardware-committer-binding",
    userId: castByRole["hardware-committer"].userId,
    roleId: "hardware-committer"
  },
  {
    bindingId: "acceptance-role-software-committer-binding",
    userId: castByRole["software-committer"].userId,
    roleId: "software-committer"
  },
  {
    bindingId: "acceptance-role-admin-binding",
    userId: acceptanceAdminOnlyUser.userId,
    roleId: "admin"
  },
  {
    bindingId: "acceptance-role-platform-admin-binding",
    userId: castByRole["platform-admin"].userId,
    roleId: "platform-admin"
  }
];

/** Users this seed must upsert itself (the ChargeLab seven come from db:seed:m0). */
const seededActors = [
  acceptanceCast.acceptanceGuest,
  acceptanceCast.acceptanceAdmin,
  acceptanceCast.platformOperator
] as const;

export async function seedAcceptanceRoleMatrix() {
  await withPgClient(async (client) => {
    for (const actor of seededActors) {
      await client.query(
        `
        insert into users (id, organization_id, name, email, title, is_active)
        values ($1, $2, $3, $4, $5, true)
        on conflict (id) do update set
          organization_id = excluded.organization_id,
          name = excluded.name,
          email = excluded.email,
          title = excluded.title,
          is_active = excluded.is_active
        `,
        [actor.userId, organizationId, actor.name, actor.email, actor.title]
      );
    }

    for (const binding of acceptanceRoleBindings) {
      // Keep exactly one org-level role so pickPrimaryPlatformRoleId cannot elevate.
      await client.query(
        `
        delete from user_role_bindings
        where user_id = $1
          and organization_id = $2
          and project_id is null
          and role_id <> $3
        `,
        [binding.userId, organizationId, binding.roleId]
      );
      await client.query(
        `
        insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
        values ($1, $2, $3, null, $4)
        on conflict (id) do update set
          user_id = excluded.user_id,
          role_id = excluded.role_id
        `,
        [binding.bindingId, binding.userId, organizationId, binding.roleId]
      );
    }
  });
}
