# Platform admin bootstrap and legacy promotion retirement

> Chinese: [Chinese](../zh-CN/runbooks/platform-admin-and-schema-promotion.md)

Bootstrap procedures for `platform-admin` and the retirement boundary of legacy driver-schema promotion.

## Bootstrap the first platform admin (production)

There is no self-service path. Self-registration and ordinary org Admin user governance cannot grant `platform-admin`.

1. Ensure migrations through `0078_platform_admin_role.sql` are applied.
2. Identify an existing active user who should hold the role, or create one with `users:manage` as a normal org Admin first.
3. Bind the role out of band (SQL example; replace ids):

```sql
insert into user_role_bindings (id, user_id, organization_id, project_id, role_id, created_at)
values (
  'urb-platform-admin-bootstrap',
  '<user_id>',
  '<home_organization_id>',
  null,
  'platform-admin',
  now()
);
```

4. Confirm `/api/v1/me` returns `platform-admin` and permissions include `platform:access` and `platform:schema-promote`.
5. Confirm `/organization/members` shows the platform-admin grant control only to a Platform Admin.

Development seed (`npm run db:seed:m0`) already binds `platform-admin` for the ChargeLab demo admin when `NODE_ENV=development`.

## Legacy promotion is retired

The Platform console, navigation entry and promotion-history API are removed. The old `/platform-console` URL uses the shared home fallback; `GET /api/v2/platform/driver-schema-promotion-history` returns 404.

Legacy overlay, promotion and revert routes still return 410 with the canonical successor link. Do not recreate legacy writes through SQL. Definition maintenance and publication use the canonical parameter-admin workflows with their existing authorization and human-confirmation requirements.

Historical promotion rows, applied migrations, audit evidence and legacy role metadata remain. This cleanup deletes no stored history and does not widen cross-organization access or Platform Admin grant authority.
