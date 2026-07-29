# Platform admin and driver schema promotion

> Chinese: [Chinese](../zh-CN/runbooks/platform-admin-and-schema-promotion.md)

Operational procedures for the cross-organization `platform-admin` role and for promoting organization driver schema overlays into the platform tier (ADR-0009).

## Bootstrap the first platform admin (production)

There is no self-service path. Self-registration and ordinary org Admin user governance cannot grant `platform-admin`.

1. Ensure migrations through `0078_platform_admin_role.sql` (and `0079` if promoting overlays) are applied.
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
5. Confirm `/platform-console` is visible and `/user-permissions` shows the platform-admin grant control only for this user.

Development seed (`npm run db:seed:m0`) already binds `platform-admin` for the ChargeLab demo admin when `NODE_ENV=development`.

## Promote an overlay to the platform tier

Blast radius: every organization that had no overlay for the compatible will start parsing it on the next ingest. Organizations that authored overlays are superseded (not deleted).

1. Open `/platform-console` as `platform-admin`.
2. Review `GET /api/v2/platform/driver-schemas/promotion-candidates`. Promote only rows with `equivalent: true`. If divergence is shown, resolve contributor disagreements offline first — the API will not merge divergent shapes.
3. Confirm the dialog states the cross-tenant blast radius and the documentation source organization.
4. Call promote (`POST /api/v2/platform/driver-schemas/promotions`). Expect:
   - one active platform overlay (`organization_id IS NULL`);
   - contributor org overlays marked `superseded`;
   - linked ParameterSpecs promoted to `organization_id IS NULL` without changing their ids;
   - platform + per-tenant audit events.
5. Spot-check attribution trees in a tenant that never authored the compatible: the chip should read platform-covered.

## Revert a promotion

1. From `/platform-console`, revert the promotion (`POST /api/v2/platform/driver-schemas/promotions/:id/revert`).
2. Expect the platform row deprecated and contributor overlays restored to `active`.
3. Confirm org-facing chips return to organization overlay coverage where expected.

## Guardrails

- Only a caller who already holds `platform-admin` may grant or revoke that role.
- Platform-admin does not widen access to another organization's parameters, logs, users, or projects.
- Prefer promote/revert through the product console. Direct SQL is emergency-only and must still invalidate the process schema registry cache (restart API processes if unsure).
