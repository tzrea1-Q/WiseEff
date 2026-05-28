# Security

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
- M5 production auth uses `AUTH_MODE=production` and verifies server-side bearer tokens before mapping signed user, organization, role, and permission claims into `AuthContext`.
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

Development auth is limited to local development and tests. `x-wiseeff-user` and the seeded development user are convenience inputs only when `AUTH_MODE=development`; production startup requires `AUTH_MODE=production`, `AUTH_TOKEN_ISSUER`, and `AUTH_TOKEN_HMAC_SECRET`. The pilot verifier checks `Authorization: Bearer <payload>.<signature>` using HMAC-SHA256 over the base64url payload, validates issuer, subject, and organization claims, and maps only signed claims into the backend auth context. Production routes must not fall back to the development user.

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
- Node writes require `debugging:write`, project access, an active session, a writable access mode, range validation, an active device lease for the session, and a pre-write snapshot.
- High-risk writes require `confirm-high-risk-write` or a future approval id.
- Snapshot rollback requires `debugging:rollback`, `confirm-rollback`, and an active device lease for the session.
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

M3.5 request correlation uses `X-Request-Id` as the HTTP request id. The server reflects a client-provided id or generates one, includes it in error responses, and passes it through M1 parameter, M2 log, and M3 debugging write services as audit `traceId`. Direct service calls without an HTTP request still generate a trace id.

## Agent Safety

Agent tools should be classified as:

- Read-only: may run automatically after permission checks.
- Preparation: may create drafts/previews without committing production state.
- Mutating: must create an approval record and wait for human approval.

Approval-time execution must re-check permissions and business state.

M4 Agent tools run only through the backend registry. Read tools still require server-side permission checks. Approval-required tools persist `agent_approvals` first, then execute only after approval-time authz and state checks. `parameter.submitChangeDraft` may create a human-review draft after approval, but it does not merge or apply production parameter values.

Agent-generated parameter changes may prepare drafts or recommendations, but production parameter writes still require a human-submitted draft/review path. Future Agent or device write tools must create an explicit approval record and then execute through the same server-side authz and audit boundary.

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

The M3 simulator-backed path implements this boundary for local verification. M3.5 adds `debug_device_leases` so node writes and snapshot rollback cannot proceed when another active session owns the device lease; the same session can renew the lease, and repository helpers can expire/release it. A production HDC gateway must preserve the same safety contract: no direct frontend device writes, no write without a lease and snapshot, no rollback without an explicit confirmation token, and no audit bypass.

## References

- `design-docs/security-governance.md`
- `design-docs/domain-model.md`
- `design-docs/api-contract.md`
