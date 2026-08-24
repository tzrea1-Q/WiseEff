# Trusted invocation provenance separates the authenticated principal from the initiator

`AuthContext` proves the authenticated user, home Organization, roles, and permissions. It does not prove whether a server-known user path, Xiaoze, or an unattended job initiated one operation. Reusing a caller-supplied optional `actorType` for that distinction lets missing values silently become `user`, while adding `actorType` to `AuthContext` would incorrectly treat an ordinary bearer credential as proof of physical human presence.

Sensitive mutation paths therefore require a server-internal **trusted invocation context** in addition to their authorization principal. It is a discriminated union:

- `user` carries the authenticated principal;
- `agent` carries the authenticated principal plus `sessionId`, `toolCallId`, and an `approvalId` when the mutating tool requires approval;
- `system` carries a named service or job identity and never invents a user principal.

Only server-known entry points construct this context. Request headers, bodies, ordinary user bearer credentials, and existing audit rows cannot declare or override it. Nested domain writes, policy guards, and their audit events propagate the same context without a default-to-user compatibility path. It is per invocation and is not stored in LangGraph checkpoints or returned from `/me`.

Agent approval and invocation provenance answer different questions. Approval authorizes one action and payload; it never converts an Agent-initiated operation into a user-initiated operation. Human-required policy accepts only a `user` initiator. Both `agent` and `system` fail closed unless a future policy explicitly permits them.

## Considered Options

- **Put an actor type on `AuthContext`.** Rejected. `AuthContext` is the authenticated principal, and an ordinary user token cannot reveal whether software or a physically present human used it.
- **Keep optional `actorType` and default missing values to `user`.** Rejected. Omission would continue to bypass human-required policy and falsify audit provenance.
- **Treat an approved Agent action as human initiated.** Rejected. Authorization by a human does not change the execution source.
- **Accept a client header, request field, or token claim as the initiator.** Rejected. The caller must not self-assert a security boundary; external Agent credentials are not a current product surface.
- **Refactor every audit producer at once.** Rejected. TD-068 owns the DTS reload mutations and parameter-sensitive production writes. Unrelated audit debt is tracked separately.

## Consequences

- TD-068 migrates all five DTS reload mutations (start, restore, deploy, configuration, and promote-to-drafts) plus every parameter-sensitive production write. Their guards and nested domain audits derive from the same trusted context.
- A missing trusted context is an internal invariant failure and performs no state write. A valid but disallowed initiator returns a stable `403` and records a refusal audit that survives rollback.
- The same authenticated principal may be allowed through a direct user entry point and refused through Xiaoze. Client attempts to spoof or downgrade the initiator have no effect.
- Cross-process Agent resume reconstructs provenance from the persisted tool call and approval records, while request-local principal and invocation data remain outside checkpoints (ADR-0024). Domain writes and their success audits remain atomic; refusal audit semantics remain as decided in ADR-0027.
- Mock mode may preserve product semantics for demos, but backend/API tests prove this security boundary. WiseEff promises honest provenance for execution paths it knows, not proof that a physical human is behind an ordinary user credential.
- The adjacent debugging device-write path whose nested audit currently reports `user` after Agent approval is not part of TD-068 and remains separate debt.
