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

## Manual acceptance: `DRV-PROMOTE-001`–`004` (step-by-step)

Local API mode. Demo login: `xu.yun` / `WiseEff-Dev!` (ChargeLab Admin; should already hold `platform-admin`).

### Chip copy (recognize these first)

| UI copy | Meaning |
| --- | --- |
| Organization-tier parse coverage | This org's configured parse coverage is active |
| Official parse coverage | Repository-pinned official coverage, or the post-promotion display state for a contributing org |
| Superseded by higher priority | A higher-priority coverage wins; organization-tier coverage does not participate in matching |
| Platform-tier parse coverage | Platform-tier parse coverage is active (non-contributor promotion path) |
| Uncovered | No usable parse coverage yet — use **Configure organization-tier parse** |

Entry points:

1. Sign in as `xu.yun`
2. **Parameter admin** → organization config → driver attribution (`/parameter-admin/modules`)
3. For promotion, open **Platform console** (`/platform-console`)

### Shared setup: register an uncovered driver + activate an org overlay

If the console already lists a ChargeLab candidate (for example `vendor,fold_registry_test`), skip setup and start at each ID's promote step.

1. On the attribution tree, **Register driver** (or claim from the unregistered queue).
2. Fill display name, a business category, and one exact compatible that pinned schemas do **not** cover (for example `vendor,accept-promote-demo`).
3. After create, **Edit** the driver group.
4. The compatible rule should show **uncovered** → **Author parse schema**.
5. **Add parameter definition** (pick or create at least one) → **Save and activate**.
6. Expect: notice of activation; rule chip **organization overlay**; tree chip **organization overlay covered**.

### `DRV-PROMOTE-002`: after promote, contributor org reads as promoted

1. Open `/platform-console` as the same user.
2. Find the compatible, confirm equivalence, **Promote**, acknowledge cross-tenant blast radius.
3. Return to `/parameter-admin/modules` and refresh.
4. **Edit** the driver group that authored the overlay.
5. Expect: rule chip **promoted to platform** (not empty / uncovered); tree chip **promoted to platform**.

### `DRV-PROMOTE-003`: authoring after platform covers is refused

When the compatible is already platform-covered, **Author parse schema** is hidden. Pass on “no successful author path + API refusal text”.

1. Confirm the compatible is platform-covered / promoted.
2. In module edit, confirm there is **no** Author parse schema button.
3. Prove the API refusal (replace `$TOKEN`):

```bash
curl -sS -X POST "http://127.0.0.1:8787/api/v2/organization-driver-schemas" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "compatible": "vendor,accept-promote-demo",
    "displayName": "should-fail",
    "properties": [{ "propertyKey": "demo_prop", "valueShape": { "kind": "string" } }]
  }'
```

4. Expect HTTP 409 mentioning that an active platform overlay already covers the compatible. The UI maps that error to the Chinese blocked copy when a save path hits it.

### `DRV-PROMOTE-004`: org that never authored still sees platform coverage

Development self-registration joins ChargeLab, so create a second-org admin once (reuse `xu.yun` password hash):

```sql
insert into organizations (id, name) values ('org-accept-b', 'Accept Org B')
  on conflict (id) do nothing;

insert into users (id, organization_id, name, title, is_active, last_active_at)
values ('u-accept-b-admin', 'org-accept-b', 'Accept B Admin', 'Admin', true, now())
  on conflict (id) do nothing;

insert into user_role_bindings (id, user_id, organization_id, project_id, role_id, created_at)
values ('urb-accept-b-admin', 'u-accept-b-admin', 'org-accept-b', null, 'admin', now())
  on conflict (id) do nothing;

insert into user_password_credentials (user_id, username, password_hash)
select 'u-accept-b-admin', 'accept.b', password_hash
from user_password_credentials where username = 'xu.yun'
on conflict (user_id) do nothing;
```

1. Finish `DRV-PROMOTE-002` for the same compatible.
2. Sign out; sign in as `accept.b` / `WiseEff-Dev!`.
3. Register a driver group with the **same** compatible; do **not** author an overlay.
4. Edit the group. Expect platform / covered chips — not uncovered.

### `DRV-PROMOTE-001`: shadowed (distinct from promoted)

**Promoted** ≠ **shadowed**. Console promote marks contributors `superseded` and is validated by `002`. **Shadowed** means the org overlay is still `active` but loses to a higher tier.

Local simulation:

1. Activate an org overlay for a fresh compatible (for example `vendor,accept-shadow-demo`).
2. Emergency SQL: insert an active platform row (`organization_id IS NULL`) for the same compatible **without** marking the org row `superseded`; restart the API to clear the schema cache.
3. Refresh. Expect shadowed chips on the rule and tree.
4. Delete the simulated platform row and restart the API when done.

If time is short, land `002` as the “not data loss” proof and record `001` as requiring the dual-active simulation above.
