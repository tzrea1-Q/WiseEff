# Organization Administration Design

> Status: **Locked design** — decisions D1–D11 settled 2026-08-19 in a grilled design session
> Date: 2026-08-19
> Chinese: [`docs/zh-CN/design-docs/2026-08-19-organization-administration-design.md`](../zh-CN/design-docs/2026-08-19-organization-administration-design.md)
> Execution plan: [`docs/exec-plans/completed/2026-08-19-organization-administration.md`](../exec-plans/completed/2026-08-19-organization-administration.md)
> ADR: [ADR-0037](../adr/0037-organization-administration-is-home-org-tenant-operations.md)

## Positioning

Organization administration is the product for operating an Organization **as itself**: membership, onboarding, and the Organization record. It is not Organization-scoped governance (ADR-0001 / ADR-0015), which remains the catalog-scope axis for specs, modules, overlays, log domains, and knowledge.

The current gap is that Organization is a security stamp (`id`, `name`, `created_at`) while local registration pretends the Hardware Department and Software Department labels are tenants. Development already joins ChargeLab and ignores that picker.

## Locked decisions

| ID | Decision |
| --- | --- |
| D1 | The new product is **Organization administration**, not a thicker parameter-admin organization area. |
| D2 | **Organization** is the tenant boundary (one company or one deployment customer). Hardware / software is **Role discipline**. |
| D3 | The product operates the caller’s **home organization** only. No Organization directory, create, archive, or switcher. Extra `organizations` rows may exist as bootstrap or fixtures. |
| D4 | Membership channels: local self-registration with an implicit Organization; target environments use OIDC JIT plus Admin-provisioned accounts. Invitations are later (TD-119). |
| D5 | **Project member** is out. Organization membership is not project access. |
| D6 | Local registration joins the **Evaluation Organization** (ChargeLab in the seeded profile). Department Organizations cease to be join targets; stray members move to the deployment home organization. Isolation tests use fixture Organizations, not product departments. |
| D7 | Utility **Organization administration** replaces **User management**. Canonical routes `/organization` (profile) and `/organization/members` (people), switched as debugging-admin scope peers. `/user-permissions` permanently redirects to `/organization/members`. Parameter-admin organization subnav is unchanged. |
| D8 | The Organization record exposes identity `id`, `created_at` (read-only), and a mutable **display name**. No slug, logo, timezone, or archive in v1. |
| D9 | `users:manage` may rename. Display name is a non-empty length-limited label, **not** globally unique. Rename is an audited write. |
| D10 | Local Admin bootstrap joins ChargeLab when present; otherwise creates or joins exactly one Organization from the bootstrap name (neutral default, never Hardware Department). Zero or many rows without an explicit target fail closed. |
| D11 | OIDC semantics stay: the token `organization_id` claim *is* the Organization. The login path does not remap department-shaped ids. |

## Domain model

| Concept | Rule |
| --- | --- |
| Organization | Tenant boundary. A user, a project, and every organization-scoped catalog belong to exactly one. |
| Home organization | The single Organization on `AuthContext`. Profile updates cannot change it. |
| Organization membership | Belonging to that Organization. Not a project ACL. |
| Organization display name | Mutable label. Identity stays on `organizations.id`. |
| Evaluation Organization | What local self-registration joins. In the seeded profile this is ChargeLab. |
| Role discipline | Hardware or software side of a platform role. Never an Organization. |
| Project member | Reserved. Out of this product. |

Scenario checks:

- **Hardware and software review the same board.** Zhang (hardware-user) and Li (software-committer) register locally and land in ChargeLab. Both see Aurora. Role discipline is chosen independently of Organization.
- **Pilot Admin renames ChargeLab.** Display name becomes the customer company. `id` stays `org-chargelab`. `/api/v1/me` returns the new name after reload. Audit records previous and next name.
- **Self-hosted local with no seed.** Bootstrap creates one Organization with a neutral name. Register joins that row. It does not create a Hardware Department organization.
- **OIDC still sends `org-software-department`.** The user stays in that Organization. Operators fix the IdP or run a data migration. Login does not silently merge tenants.
- **Software engineer should not see an unannounced board.** Out of v1. Every Organization member still sees every project.

## Product surface

One sidebar destination, two scope pages, `users:manage` (same as today’s user governance):

1. **Profile** (`/organization`) — display name (editable), id, created time.
2. **People management** (`/organization/members`) — today’s user directory: create, role replace, activate/deactivate, Committer registration approval. No project column.

Sidebar label: Organization administration. Old deep links to `/user-permissions` redirect to `/organization/members` and keep query strings.

## Membership

| Runtime | How a person joins |
| --- | --- |
| Local eval (`AUTH_PROVIDER=local`) | Self-register without an Organization picker. Join the Evaluation Organization (ChargeLab when seeded; otherwise the single bootstrap Organization). Committer still pending-approval. Admin cannot self-register. |
| Target (`AUTH_PROVIDER=oidc`) | IdP claim + existing JIT. Admin may still provision local-shaped accounts through user governance where that path exists. |
| Later | Invitation links or email (TD-119). |

`POST /api/v1/auth/register` stops requiring a department Organization field. Clients that still send the retired Hardware Department organization name are ignored or rejected after a short compatibility window documented in the plan — they must not create `org-hardware-department`.

## Organization write API

- `GET /api/v1/organization` — caller’s home organization (`users:manage` or any authenticated member; product page uses manage).
- `PATCH /api/v1/organization` — `{ name }` only; `users:manage`; audited `organization-update`.
- Existing `/api/v1/users*` stay. No `/api/v1/organizations` collection.

## Non-goals (v1)

- Organization directory, create, archive, switch (TD-120).
- Project member / project-scoped roles (TD-121).
- Invitations, email verification, verified-domain join (TD-119).
- Tenant + Department as two entities.
- New permission `organization:manage`.
- OIDC claim remapping.
- Renaming `org-chargelab` as an identifier.

## Permissions and audit

No new permission keys. `users:manage` covers members and display name. `platform-admin` still cannot list other Organizations’ users. Rename and user mutations stay High-severity audited writes in the same transaction as the domain write (ADR-0027).
