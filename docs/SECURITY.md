# Security

> Chinese: [Chinese](zh-CN/SECURITY.md)

WiseEff security centers on identity, authorization, audit, Agent tool governance, device safety, and data isolation.

## Non-Negotiables

- Frontend permission checks are UX only; backend writes enforce permissions.
- All production writes must produce audit evidence.
- Agent model output cannot directly mutate production state.
- Device writes require permission, validation, confirmation, snapshot, and audit.
- Production cannot use mock runtime as a business data source.

## Current Security Baseline

- Frontend role model lives in `src/domain/users/types.ts`.
- Page/action permission helpers live in `src/app/permissions.ts`.
- M0 backend auth context lives in `server/modules/auth/`.
- M6.2 production auth uses `AUTH_MODE=production` with `AUTH_PROVIDER=oidc` for OIDC discovery/JWKS validation, then resolves the effective `AuthContext` from WiseEff PostgreSQL user and role tables.
- WiseEff local account auth uses `AUTH_PROVIDER=local`, salted `scrypt` password hashes, hashed opaque session tokens, and the same database-backed `AuthContext` resolution as `/api/v1/me`.
- The M5 HMAC verifier remains available for local smoke/test profiles only; it is not target-environment identity evidence.
- Backend user governance lives under `/api/v1/users` and requires `users:manage`, durable role updates, self-lockout prevention, and audit evidence.
- M0 audit boundary lives in `server/modules/audit/`.
- M1 parameter write routes live in `server/modules/parameters/`; they validate payloads, enforce server-side permissions, and write audit evidence for submits, review decisions, merges, and imports.
- Security governance design lives in `design-docs/security-governance.md`.

## Permission Model

Current frontend permissions include:

- `parameter:view`
- `parameter:edit`
- `debugging:use`
- `logs:upload`
- `parameter:review`
- `admin:access`
- `users:manage`

When adding backend business routes, map frontend capabilities to server-side authorization checks and include negative tests for forbidden users.

Development auth is limited to local development and tests. `x-wiseeff-user` and the seeded development user are convenience inputs only when `AUTH_MODE=development`; production startup requires `AUTH_MODE=production`. Target self-hosted identity should use `AUTH_PROVIDER=oidc` with `AUTH_OIDC_ISSUER` and `AUTH_OIDC_AUDIENCE`; the verifier checks OIDC access tokens through discovery/JWKS and then reloads effective active state, role bindings, and permissions from WiseEff PostgreSQL. WiseEff-owned local accounts use `AUTH_PROVIDER=local`; the API resolves `we_local_*` bearer session tokens from PostgreSQL and still reloads active state, role bindings, and permissions. Local HMAC smoke uses `AUTH_PROVIDER=hmac`, `AUTH_TOKEN_ISSUER`, and `AUTH_TOKEN_HMAC_SECRET`. Production routes must not fall back to the development user or trust token role claims as final authorization.

OIDC tokens must include identity and organization claims. `wiseeff_roles` may be emitted for compatibility or bootstrap diagnostics, but production authorization is database-backed. Email-based account linking is allowed only when the OIDC token includes `email_verified=true`; otherwise WiseEff matches by stable `sub` only. Role ids outside the documented platform role set, wrong issuer, wrong audience, expired tokens, not-yet-valid tokens, unsigned tokens, and invalid signatures are unauthenticated failures.

Local account registration creates a username-based account with the selected organization and an allowed self-service platform role. Admin self-registration is rejected server-side. Hardware/Software Committer registration requests create an inactive account with the matching base User role and a pending request; they do not receive a session token and cannot log in until an Admin approves the request through user governance, which activates the account and grants the requested Committer role. Email verification is not supported yet, so registration must not be treated as proof of email-domain ownership or invitation acceptance. Local account passwords are stored only as salted `scrypt` hashes, and `auth_sessions` stores only SHA-256 hashes of opaque session tokens. Browser local account tokens are kept in `localStorage` for the current productized local-account flow; deployments that require SSO, MFA, refresh-token rotation, or stronger browser session isolation should use OIDC or a hardened reverse-proxy/session integration.

For M1 parameter management:

- Parameter reads require `parameter:view`.
- Drafts and submission rounds require project-scoped `parameter:edit`.
- Review advancement and rejection require the matching hardware/software workflow role or admin privilege.
- Merge writes require the software-user workflow slot or admin privilege and re-check high-risk review evidence before updating the current value.

For M2 log analysis:

- Log reads require `logs:view` and are project-scoped through the authenticated role bindings.
- Log uploads require active-user `logs:upload`; unsupported file extensions still create a failed record with a readable reason instead of bypassing audit.
- Rerun analysis requires `logs:analyze`.
- Archive and unarchive require active-user `logs:archive`; default log lists exclude archived records unless `includeArchived=true`.
- Feedback requires active-user `logs:feedback` and stores only the rating/note needed for quality review.

For M3 debugging:

- Device and parameter reads require `debugging:view` and `debugging:read`.
- Debugging catalog administration requires `debugging:admin`; this governs parameter metadata and HDC/ADB node-binding changes only.
- Node writes require `debugging:write`, project access, an active session, a writable access mode, range validation, an active device lease for the session, and a pre-write snapshot.
- High-risk writes require `confirm-high-risk-write` or a future approval id.
- Snapshot rollback requires `debugging:rollback`, `confirm-rollback`, and an active device lease for the session.
- Bridge-backed sessions additionally require a user-owned, non-revoked, online device bridge and persist `execution_mode=bridge` plus `bridge_id` for audit and rollback continuity.
- Frontend disabled buttons are UX only; the backend rejects read-only writes, missing confirmations, bad ranges, inactive sessions, and unauthorized actors.

## Audit Requirements

Audit records should capture:

- actor,
- target,
- action,
- severity,
- metadata,
- trace/request id,
- timestamp,
- project or organization scope.

Audit should cover login/security events, parameter writes, review decisions, log uploads/reruns/archive actions, device reads/writes, Agent tools, admin changes, and exports.

M1 parameter-management writes emit audit events from the backend for `parameter-submit`, `parameter-review-advance`, `parameter-review-reject`, `parameter-merge`, and `batch-import`. The frontend audit drawer is not the security boundary; audit creation happens server-side with the authenticated actor and request trace id.

M2 log-analysis writes emit backend audit events for `log-upload`, `log-upload-failed`, `log-rerun`, `log-archive`, `log-unarchive`, and `log-feedback`. The UI may hide or disable actions by role, but the server permission check and audit write are the authoritative boundary.

M3 debugging emits backend audit events for target detection, session creation, node reads, node writes, and snapshot rollback. Write audit metadata includes the session, operation, node path, requested value, previous value, readback value, verification result, failure reason, and snapshot id when applicable.

Complex debug writes add format-aware metadata to audit and operation records: `valueKind`, `valueFormat`, `normalizationMode`, byte length, digest, and a size-capped `valuePreview`. Large raw payloads must not be duplicated in audit metadata or acceptance evidence; digests and previews are the durable comparison surface. `maxValueBytes` and service defaults cap write payload size server-side. Device-write approval, lease, snapshot, and confirmation boundaries are unchanged.

Debugging admin catalog writes emit audit events for parameter metadata and binding changes. Binding audit metadata should avoid publishing raw node paths unless the deployment policy explicitly allows them. Catalog administration does not authorize device writes; device node writes still go through the runtime debugging path with confirmation, lease, snapshot, readback, and audit checks.

M3.5 request correlation uses `X-Request-Id` as the HTTP request id. The server reflects a client-provided id or generates one, includes it in error responses, and passes it through M1 parameter, M2 log, and M3 debugging write services as audit `traceId`. Direct service calls without an HTTP request still generate a trace id.

M6.2 user-governance writes emit backend audit events for user creation, profile update, activation/deactivation, role replacement, and local registration role-request approval/rejection. These mutations must stay transactionally coupled to durable state updates and must prevent the active Admin from removing its own final Admin capability.

Local account auth writes backend audit events for registration, login, logout, and current-user profile updates. Logout must revoke the active session token server-side, and profile updates must not allow the current-user route to change email, roles, activation state, or organization.

## Telemetry Security

M6.5 observability data is operations evidence, not a public API. `/metrics` can expose route names, dependency status, queue counts, provider status, and high-risk operation counters, so production and pilot deployments must keep it private through private-network scraping, VPN, reverse-proxy allowlist, mTLS, or a stronger equivalent control.

Telemetry must not include bearer tokens, provider keys, raw uploaded log content, raw parameter values, raw device write payloads, or credentials in labels, logs, traces, dashboards, alert annotations, or incident evidence. Structured log helpers redact common secret-bearing keys, and `npm run observability:check` scans observability config and dashboards for obvious secret leakage.

## Agent Safety

Agent tools should be classified as:

- Read-only: may run automatically after permission checks.
- Preparation: may create drafts/previews without committing production state.
- Mutating: must create an approval record and wait for human approval.

Approval-time execution must re-check permissions and business state.

M4 Agent tools run only through the backend registry. Read tools still require server-side permission checks. Approval-required tools persist `agent_approvals` first, then execute only after approval-time authz and state checks. `parameter.submitChangeDraft` may create a human-review draft after approval, but it does not merge or apply production parameter values.

Agent-generated parameter changes may prepare drafts or recommendations, but production parameter writes still require a human-submitted draft/review path. Any future Agent/device write convergence must create an explicit approval record and then execute through the same server-side authz and audit boundary.

The live Agent provider adds a registry seam so the backend can reject unknown tool names, block ungrounded mutating requests, and fall back cleanly when the provider is unavailable. `AGENT_API_FORMAT=pi` uses `@earendil-works/pi-ai` only as a backend planning adapter; Pi output is advisory until the WiseEff tool registry, authorization, approval, and audit paths accept it. Pi Coding Agent CLI, Pi filesystem tools, Pi shell tools, and project-local `.pi` extensions are not exposed in the WiseEff product runtime. Safe provider evidence may expose provider mode, provider format, Pi provider id, model id, and prompt version in readiness JSON and traces; it must not expose API keys, Authorization headers, raw prompts, raw provider payloads, or customer data. Provider traces now capture latency, token usage, estimated cost, safety status, safety reasons, and fallback reason so security review can distinguish grounded planning from degraded output.

Provider outages must not silently execute tools. A degraded assistant response is allowed only when the provider health check fails or the transport is unavailable, and the fallback path must skip tool execution entirely. Provider outages and device failures must leave audit/readiness evidence rather than silently passing.

## Backup And Object Storage Security

- S3-compatible object storage credentials, signed URLs, database URLs with passwords, and bearer tokens must never be committed.
- Backup/restore evidence may be committed only after redaction and only when it contains summaries, counts, object keys/prefixes, and command statuses rather than database dumps or object bytes.
- Restore drills must use isolated database and object-store targets. Restoring into the live production database, live bucket, or live prefix is a safety violation.
- `/health/ready` object-store failures must use safe categories and remediation hints rather than raw provider responses that can contain signed headers or credentials.
- Provider lifecycle, encryption, replication, credential rotation, and backup/export procedures are operator responsibilities and must be recorded with target evidence.

## Device Safety

Device access must go through a gateway boundary. Write requests need:

- request id,
- user and permission context,
- device and node target,
- access mode,
- target value,
- risk level,
- confirmation/approval id,
- pre-write snapshot,
- readback result or failure reason.

The M3 simulator-backed path implements this boundary for local verification. M3.5 adds `debug_device_leases` so node writes and snapshot rollback cannot proceed when another active session owns the device lease; the same session can renew the lease, and repository helpers can expire/release it. M5 and the ADB/HDC protocol work add HDC and ADB adapters behind the same `DebugDeviceGateway` boundary with argv-based process execution, command timeouts, stderr/nonzero normalization, and read-back mismatch reporting. Production deployments must set `DEBUG_DEVICE_GATEWAY_MODE=hdc`, `adb`, or `multi`; `DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true` is only acceptable for non-customer staging. HDC, ADB, and live Agent provider seams are implemented, but real pilot readiness depends on target-environment evidence. Real hardware evidence still belongs in pilot/device-lab acceptance: no direct frontend device writes, no write without a lease and snapshot, no rollback without an explicit confirmation token, and no audit bypass.

Local device bridge connectivity uses short-lived pairing codes and scoped bridge tokens (`device-bridge:connect`, `device-bridge:execute`) that are validated server-side before WebSocket registration and RPC execution. Browser bridge health probes and pairing UI do not grant device-write authority; only authenticated debugging routes can create bridge-backed sessions and governed writes.

Bridge rename (`PATCH /api/v1/device-bridges/:bridgeId`) and revoke (`POST /api/v1/device-bridges/:bridgeId/revoke`) require `debugging:use`, must target a user-owned bridge, and revoke immediately invalidates the bridge token for new WebSocket connections. Renaming updates display metadata only; it does not rotate credentials or grant additional scopes.

## References

- `design-docs/security-governance.md`
- `design-docs/domain-model.md`
- `design-docs/api-contract.md`
- `security/README.md`
- `runbooks/identity-provider.md`
