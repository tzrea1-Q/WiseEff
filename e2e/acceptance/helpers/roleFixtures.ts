import { withPgClient } from "./database";

const organizationId = "org-chargelab";

const acceptanceRoleBindings = [
  { bindingId: "acceptance-role-guest-binding", userId: "acceptance-role-guest", roleId: "guest" },
  { bindingId: "acceptance-role-hardware-user-binding", userId: "u-zhao-heng", roleId: "hardware-user" },
  { bindingId: "acceptance-role-software-user-binding", userId: "u-liu-min", roleId: "software-user" },
  { bindingId: "acceptance-role-hardware-committer-binding", userId: "u-wang-jie", roleId: "hardware-committer" },
  { bindingId: "acceptance-role-software-committer-binding", userId: "u-sun-mei", roleId: "software-committer" },
  { bindingId: "acceptance-role-admin-binding", userId: "u-xu-yun", roleId: "admin" }
] as const;

export async function seedAcceptanceRoleMatrix() {
  await withPgClient(async (client) => {
    await client.query(
      `
      insert into users (id, organization_id, name, email, title, is_active)
      values ($1, $2, 'Acceptance Guest', 'acceptance.guest@chargelab.cn', 'Guest Viewer', true)
      on conflict (id) do update set
        organization_id = excluded.organization_id,
        name = excluded.name,
        email = excluded.email,
        title = excluded.title,
        is_active = excluded.is_active
      `,
      ["acceptance-role-guest", organizationId]
    );

    for (const binding of acceptanceRoleBindings) {
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
