# ADR-0048: Integration credentials are a machine principal, not a user

> Chinese companion: [Chinese](../zh-CN/design-docs/adr-0048-integration-credentials-are-a-machine-principal.md)

Date: 2026-10-19

## Status

Accepted. This extends ADR-0038. Implementation is tracked by #1248 under the [analysis skill platform plan](../exec-plans/active/2026-10-18-log-analysis-skill-platform.md).

## Context

External systems that push device logs to WiseEff today can only authenticate as a person: a user's bearer token. That token carries the user's roles and permissions across the whole product, stops working when the person leaves, and makes every upload look user-initiated. The analysis skill platform (ADR-0047, spec #1221 user stories 74–76) needs self-service integration. An integrator copies a skill key and a credential from the skill's 集成 section and pushes logs without a personal account.

ADR-0038 separates the authenticated principal (`AuthContext`, always a user) from the server-constructed initiator (`user`, `agent` or `system`). Neither fits a machine caller:
- `AuthContext` requires a user;
- `system` names server-owned jobs, not credentials held outside the server;
- disguising a credential as a user would falsify audit provenance, which is exactly what ADR-0038 forbids.

## Decision

1. **An integration credential is its own principal type.** It is organization-scoped and has:
   - an id;
   - a display name;
   - an optional single skill binding;
   - a fixed scope: upload logs and read the records it created.

   It is never a user. It never carries `AuthContext`, roles or permissions, and it never appears in user lists, role bindings or `/me`.
2. **Bearer format and storage.** The secret is a random value of at least 256 bits, presented as `Authorization: Bearer wie_<credentialId>_<secret>`.
   - The `wie_` prefix routes the request to the credential resolver; every other bearer stays on the existing user resolvers.
   - The server stores only a hash of the secret and compares in constant time.
   - The plaintext is returned once, at issue or rotation, and is never logged, audited, persisted or retrievable.
3. **Allowlisted routes only, fail closed.**
   - An integration principal is accepted only by an explicit allowlist: the log upload endpoints (`POST /api/v1/log-files`, `POST /api/v1/logs`), and reads of a record, its report and its files where the record was created by the same credential.
   - Every other route keeps requiring a user `AuthContext` and rejects the credential with `401`/`403` before any handler or domain read runs.
   - A credential bound to a skill can upload only to that skill. A conflicting or unbound skill selector returns `403`.
4. **Records remember their creating credential.** A record created by a credential stores `created_by_credential_id`, with a composite organization foreign key and a null uploading user. Organization users with `logs:view` still see these records like any other organization record. A credential can never read another credential's or a user's records.
5. **A new initiator for provenance.** The trusted invocation union gains `integration`, carrying the credential id and organization, constructed only by the credential resolver. Audit rows record `actor_type = integration` with the credential id. Human-required policies reject `integration`, just as they reject `agent` and `system` (ADR-0038).
6. **Lifecycle is administered and audited.**
   - Users with `logs:admin-domains` issue, rotate and revoke credentials in the skill workspace's 集成 section.
   - Issue, rotate and revoke are audited writes in the same transaction (ADR-0027).
   - Rotation replaces the secret immediately; revocation takes effect on the next request.
   - The server records `last_used_at`, updated at most once a minute to avoid write amplification.
   - Archiving a bound skill revokes its credentials.
   - Uploads by a credential use the same size, rate and analysis limits as user uploads.

## Considered Options

- **Personal access tokens for users.** Rejected. They inherit the person's broad permissions, disappear when the person leaves, and record machine traffic as human.
- **Service user accounts.** Rejected. Fake users pollute user management and role bindings and falsify ADR-0038 provenance. Their reach is whatever roles someone grants them, rather than a fixed scope.
- **OAuth 2.0 client credentials.** Rejected for now. It needs an authorization server and token exchange that the product does not otherwise have. The credential resolver can later be replaced by a token exchange without changing the principal model.
- **Signed requests (HMAC per request).** Rejected for the first version. Bearer secrets over TLS match the existing API surface and integrator tooling (`curl`); request signing can be added as a later hardening without changing the principal.

## Consequences

- The auth layer gains a second resolver and a principal union at the route boundary. Most routes are unchanged because they keep requiring a user context, so the credential's reach is exactly the allowlist.
- A new table holds the credentials, with organization foreign keys, a hash, the skill binding, status, `last_used_at` and audit linkage. Records gain a nullable creating-credential column. Tenant isolation is enforced in queries and in foreign keys.
- Integration examples (`curl`) and the integration guide switch from personal tokens to integration credentials.
- A leaked credential can upload logs to one Organization (optionally one skill) and read only what it uploaded. Revocation is immediate, and every use is attributable to that credential.
