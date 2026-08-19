# Organization administration is home-org tenant operations, not departments or project ACL

Local registration treats 硬件部 / 软件部 as Organizations, the domain model mentions `ProjectMember`, and “组织治理” collides with Organization-scoped governance (ADR-0001). We decided that **Organization** is the tenant boundary (one company or one deployment customer), and **Organization administration** is the product for operating the caller’s home organization: membership, onboarding, and the Organization display name.

Hardware and software stay **Role discipline**, never Organizations. The product does not list, create, or switch Organizations; `platform-admin` still does not widen access to other Organizations’ business data. Project membership is out of this product. Invitations are a later membership channel.

## Considered Options

- **Keep 硬件部 / 软件部 as Organizations (department-as-tenant).** Rejected. Parameter review slots need hardware and software actors in the same Organization. Today’s development register path already dumps both choices into ChargeLab; the picker is a lie.
- **Split Tenant and Department as two entities.** Rejected for this product. Isolation, platform rows (`organization_id IS NULL`), and home-organization AuthContext already mean tenant. Department can wait.
- **Ship a platform Organization directory** (create / archive / switch). Rejected for v1. Self-hosted and Internal Beta operate one home organization; extra `organizations` rows stay bootstrap or fixtures.
- **Fold Project member and project-scoped roles into Organization administration.** Rejected. Organization membership is not project access. The unused `user_role_bindings.project_id` is not shipped product.
- **Deepen Organization-scoped governance instead.** Rejected. Specs, modules, and overlays are already a product (ADR-0001 / ADR-0015). The gap is the Organization as an operable record.

## Consequences

- Local self-registration joins the Evaluation Organization (ChargeLab in the seeded profile) and drops the department picker. Non-development `AUTH_PROVIDER=local` must not mint department Organizations.
- Target environments keep OIDC JIT plus Admin-provisioned accounts. Open registration is not production onboarding. OIDC still treats the token `organization_id` claim as the Organization; the login path does not remap department-shaped ids.
- Local Admin bootstrap joins ChargeLab when that row exists; otherwise it creates or joins exactly one Organization from the bootstrap name (neutral default, never 硬件部). Zero or many Organizations without an explicit target fail closed.
- The utility entry **组织管理** replaces **用户管理**. `/user-permissions` redirects. The parameter-admin organization area is unchanged.
- Organization identity stays `organizations.id`. Holders of `users:manage` may change the display name (label, not a unique key). Slug, logo, and archive are out of v1. Rename is an audited write.
