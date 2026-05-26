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

For M1 parameter management:

- Parameter reads require `parameter:view`.
- Drafts and submission rounds require project-scoped `parameter:edit`.
- Review advancement and rejection require the matching hardware/software workflow role or admin privilege.
- Merge writes require the software-user workflow slot or admin privilege and re-check high-risk review evidence before updating the current value.

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

## Agent Safety

Agent tools should be classified as:

- Read-only: may run automatically after permission checks.
- Preparation: may create drafts/previews without committing production state.
- Mutating: must create an approval record and wait for human approval.

Approval-time execution must re-check permissions and business state.

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

## References

- `design-docs/security-governance.md`
- `design-docs/domain-model.md`
- `design-docs/api-contract.md`
