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
- Browser acceptance for workflow role boundaries runs the API in production auth mode with test-only HMAC tokens and switches the actual browser credential for every actor. Development `x-wiseeff-user` injection or one Admin token is not valid Hardware/Software Committer or Software User UI evidence.
- Backend user governance lives under `/api/v1/users` and requires `users:manage`, durable role updates, self-lockout prevention, and audit evidence.
- M0 audit boundary lives in `server/modules/audit/`. Audit integrity is a seam, not a convention (ADR-0027): an audit event is exactly one of **audited-write evidence** (commits in the same transaction as the domain write, via `withAuditedWrite` / `writeAuditEventInTx` with the `AuditTx` brand), **refusal evidence** (deny-then-throw; written on the pool handle via `writeRefusalAudit` so it survives the rollback its own throw causes), or **milestone evidence** (stepwise flows; written immediately via `writeMilestoneAudit` so it survives later step failures). `auditRatchet.test.ts` pins the remaining direct `createAuditEvent` calls — all documented permanent residents.
- M1 parameter write routes live in `server/modules/parameters/`; they validate payloads, enforce server-side permissions, and write audit evidence for submits, review decisions, merges, imports, and **project initialization** submit/approve/reject (`project-initialization-*` audit kinds).
- Security governance design lives in `design-docs/security-governance.md`.

## Permission Model

Current frontend permissions include:

- `parameter:view`
- `parameter:edit`
- `parameter:edit-critical` (safety-critical / sensitive-node writes; Hardware/Software Committer and Admin have it by default)
- `debugging:use`
- `logs:upload`
- `knowledge:view` (default for all organization members)
- `knowledge:edit` (create entries; govern OWN entries)
- `knowledge:manage` (govern any entry; hard delete; admin-tier)
- `parameter:review`
- `admin:access`
- `users:manage`
- `platform:access` (platform console; `platform-admin` only)
- `platform:schema-promote` (cross-org overlay promotion; `platform-admin` only)

`platform-admin` is the first cross-organization role. It keeps a home organization on `AuthContext` and does **not** widen access to other tenants' parameters, logs, users, or projects. It unlocks platform-scoped rows (`organization_id IS NULL`) and one bounded aggregate read (promotion candidates). Only a caller who already holds `platform-admin` may grant or revoke that role. Platform-scoped audit events may use a null `organization_id` and fan out one organization-scoped event per affected tenant; ordinary list endpoints still filter by the caller's organization.

When adding backend business routes, map frontend capabilities to server-side authorization checks and include negative tests for forbidden users.

**Node-level sensitive rules (P3):** `dts_sensitive_node_rules` match org/optional-project `path` or `compatible` patterns to `high`/`critical` risk tiers and a required capability (default `parameter:edit-critical`). Writes that hit a rule without the capability return `403`. Agent actors (`actorType=agent`, including Xiaoze `action.submitParameterChange`) that hit `critical` are always denied, audited as `parameter-sensitive-node-denied` with `requireHuman: true`, and must be completed by a human.

**DTS reload sensitive-node extension (#284):** Starting a reload run evaluates every selected parameter against the same rules (path and compatible). A match additionally requires `parameter:edit-critical` on top of `debugging:dts-reload`. A critical-tier match also requires request-body `confirmationToken: "confirm-sensitive-reload"` and is audited at severity `High` naming the matched rule — critical parameters remain reloadable when both gates pass (not blanket-refused). Agent actors are refused from every DTS reload mutating path — start, deploy, restore, **and** admin reload-configuration writes (`PUT` organisation config) — before any sensitive evaluation, audited as `dts-reload-agent-refused` with `requireHuman: true` and returning `403` with `details.code: "dts-reload-agent-refused"` (#301 / #304). #280's outright Agent refusal for reload debugging includes configuration; #301's narrower start/deploy/restore AC closed a specific gap and did not carve out a configuration exemption. The narrower sensitive-match refusal (`dts-reload-sensitive-node-denied`, also `requireHuman: true`) remains as defence in depth. Refusals return `403` with distinguishable `details.code: "sensitive-node-reload-denied"` (binding, rule, tier). Candidate list responses include server-computed `sensitiveMatch` so the UI can mark elevated requirements before start. Device-deploy confirmation (`confirm-dts-reload`) is collected by the UI on deploy (#285) and composes after this gate; runtime code must never inject either token.

**DTS reload Agent actor-type trust boundary (#304 / TD-068):** `assertDtsReloadHumanActor` (and the parameters `SensitiveWriteActorType` pattern it mirrors) keys off a **caller-supplied in-process** `actorType`, not an authenticated field on `AuthContext`. The gate binds Agent tool / service callers that pass `actorType: "agent"`. An agent that presents a normal user HTTP token is indistinguishable from a human at this boundary — the same limitation as parameter sensitive writes. Do not treat the gate as authenticated actor typing until TD-068 is addressed.

**DTS reload snapshot (#285 / ADR-0021):** For the reload device-write path, the platform's snapshot non-negotiable is satisfied by a **reload snapshot** recorded on the run: library baseline values for each target, the deployed artifact digest verified against the on-device copy (with the integrity-check strength actually achieved — `sha256` / `md5` / `byte-length`), and any kernel-side signal obtained later. It does not claim effective device-tree values and is not stored in `debugging_snapshots`, whose semantics assume a previous value can be written back.

**DTS reload residue and restore-baseline (#288):** After an ordinary reload run reaches a post-device-write terminal (`unverifiable` / `verified` / `contradicted`), the platform records **reload residue** for that organisation+device in `dts_reload_device_residue` (source run + parameters). Residue is platform bookkeeping from run history — not a device fact — and must be presented with that limitation (reboot / reflash / out-of-band changes invalidate it). Restore-baseline starts a new run (`purpose: restore-baseline`) whose debug values are the current library baselines for the residue parameter set; it reuses the same start + deploy path (`confirm-sensitive-reload` at start when required, `confirm-dts-reload` at deploy) with distinct audit kinds `dts-reload-restore-*`. Successful restore post-write terminals clear residue; failed restore leaves it.

**DTS reload run history (#289):** Listing and reading reload runs (and candidate last-reload projections) ride `debugging:view` (or `debugging:dts-reload`). Starting, deploying, restoring, and configuration remain gated as before. Compiled overlay blobs are retained for `RELOAD_ARTIFACT_RETENTION_DAYS` (90) from run `completed_at` (else `created_at`); after expiry, run metadata and digests remain readable and artifact download returns `410` with `details.code: "reload-artifact-expired"`.
Development auth is limited to local development and tests. `x-wiseeff-user` and the seeded development user are convenience inputs only when `AUTH_MODE=development`; production startup requires `AUTH_MODE=production`. Target self-hosted identity should use `AUTH_PROVIDER=oidc` with `AUTH_OIDC_ISSUER` and `AUTH_OIDC_AUDIENCE`; the verifier checks OIDC access tokens through discovery/JWKS and then reloads effective active state, role bindings, and permissions from WiseEff PostgreSQL. WiseEff-owned local accounts use `AUTH_PROVIDER=local`; the API resolves `we_local_*` bearer session tokens from PostgreSQL and still reloads active state, role bindings, and permissions. Local HMAC smoke uses `AUTH_PROVIDER=hmac`, `AUTH_TOKEN_ISSUER`, and `AUTH_TOKEN_HMAC_SECRET`. Production routes must not fall back to the development user or trust token role claims as final authorization.

OIDC tokens must include identity and organization claims. `wiseeff_roles` may be emitted for compatibility or bootstrap diagnostics, but production authorization is database-backed. Email-based account linking is allowed only when the OIDC token includes `email_verified=true`; otherwise WiseEff matches by stable `sub` only. Role ids outside the documented platform role set, wrong issuer, wrong audience, expired tokens, not-yet-valid tokens, unsigned tokens, and invalid signatures are unauthenticated failures.

Local account registration creates a username-based account with the selected organization and an allowed self-service platform role. Admin self-registration is rejected server-side. Hardware/Software Committer registration requests create an inactive account with the matching base User role and a pending request; they do not receive a session token and cannot log in until an Admin approves the request through user governance, which activates the account and grants the requested Committer role. Email verification is not supported yet, so registration must not be treated as proof of email-domain ownership or invitation acceptance. Local account passwords are stored only as salted `scrypt` hashes, and `auth_sessions` stores only SHA-256 hashes of opaque session tokens. When `NODE_ENV=development`, `db:seed:m0` may upsert fixed ChargeLab demo usernames and a shared developer-only password for local UI testing; non-development seeds must not write those demo credentials, and demo passwords must never be used on production or customer databases. Browser local account tokens are kept in `localStorage` for the current productized local-account flow; deployments that require SSO, MFA, refresh-token rotation, or stronger browser session isolation should use OIDC or a hardened reverse-proxy/session integration.

For M1 parameter management:

- Parameter reads require `parameter:view`.
- Drafts and submission rounds require project-scoped `parameter:edit`.
- Review advancement and rejection require the matching hardware/software workflow role or admin privilege.
- Merge writes require the software-user workflow slot or admin privilege and re-check high-risk review evidence before updating the current value.
- Parameter module tree CRUD (`/api/v1/parameter-modules*`) requires `admin:access` (`canAdminParameters`). Non-admin users may still list modules when they have `parameter:view`. Deletes return `409` when child modules or assigned parameters remain; moves reject cycles with `409`. **Kind-scoped write guards (ADR-0010):** `node-type` modules may be renamed/moved and deleted only when empty (no bindings, no children); the org `unclassified` root is read-only (no rename/move/delete); `driver-group` delete routes through **disband** (drops subtree mappings, re-parks bindings, removes empty auto descendants); reclassify whitelist is `{business, node-type}`. v2 module-attribution routes (`/api/v2/parameter-modules/*` except registry/discovery-hints GET) require the same admin gate.

For project parameter governance (`/parameter-admin/projects/:projectId/*`):

- Irreversible project governance actions require an explicit human confirmation step in the UI before the request is sent: baseline release, baseline rollback, config-set member removal, and both file-conflict arbitration sides. Each confirmation states the blast radius, and arbitration can record an operator reason that travels with the audit hint.
- When the revision validation gate reports `requiresConfirmation`, release stays blocked until the operator acknowledges the named risk. A gate result is never treated as advisory text only.
- Revision validation is offered only for a real configuration revision selected by the caller. There is no fixture or fallback revision id, so no synthetic id can reach an audit record.
- These confirmations are UX safety, not the authorization boundary: `/api/v1` and `/api/v2` routes still enforce permissions, project scope, and audit server-side, and they must reject a write whose confirmation the client skipped.

For M2 log analysis:

- Log reads require `logs:view` and are project-scoped through the authenticated role bindings.
- Log uploads require active-user `logs:upload`; unsupported file extensions still create a failed record with a readable reason instead of bypassing audit.
- Rerun analysis requires `logs:analyze`.
- Archive and unarchive require active-user `logs:archive`; default log lists exclude archived records unless `includeArchived=true`.
- Feedback requires active-user `logs:feedback` and stores only the rating/note needed for quality review.

For product feedback:

- Product feedback submit requires an active authenticated user; it does not require Admin because Internal Beta users need a low-friction report path.
- Admin review routes (`GET/PATCH /api/v1/product-feedback*`) and attachment content reads require `admin:access`.
- `product_feedback` and `product_feedback_attachments` are organization-scoped and every repository read/write filters by the authenticated `organization_id`.
- Attachments are limited to `image/png`, `image/jpeg`, or `image/webp`, up to 5 images, 5 MB per image, and 15 MB total. The database stores metadata and object-store keys, not inline image bytes.
- Product feedback is product-level beta feedback and must remain separate from M2 log-analysis feedback and its `logs:feedback` permission.

For the knowledge base:

- Every `/api/v1/knowledge/*` route enforces `knowledge:view` / `knowledge:edit` / `knowledge:manage` server-side; UI gating is UX only.
- Publisher accountability (design D18): `knowledge:edit` creates entries and governs OWN entries (edit, publish, archive); it never publishes or edits another person's work. Cross-person governance and hard delete concentrate in `knowledge:manage`.
- Draft entries are visible to their owner and `knowledge:manage` holders only; search covers published entries only, so drafts and archived entries cannot leak through retrieval.
- `knowledge_entries`, `knowledge_revisions`, and `knowledge_files` are organization-scoped and every repository read/write filters by the authenticated `organization_id`.
- File uploads accept PDF, `.docx`, `.doc`, and plain text/markdown up to 20 MB; bytes live in the shared object store while the database stores metadata, checksums, and honest extraction state.
- Distillation (`POST /api/v1/knowledge/distill-from-log`) is a double-gated read-then-create: the caller needs `knowledge:edit` to create the draft AND `logs:view` plus organization scope on the source analysis record (enforced by the logs service). The pre-filled draft couples only to the stored analysis-record DTO — analyzer rule ids never enter knowledge content.
- The agent write tool `action.createKnowledgeDraft` (Phase 3) follows the standard mutating-tool contract: it always pauses for explicit human approval through the DB-backed approval chain before any write, executes under the calling user's AuthContext (`knowledge:edit` enforced at execution), creates a NEW draft only (agents never modify existing entries), and records the creating session (`source_session_id`) and user for publisher accountability. Its audit trail carries `actorType=agent`.
- Agent-draft publish rights: `knowledge:edit` may publish or archive-reject drafts distilled in their OWN sessions (the draft's `created_by_user_id` is the session user); `knowledge:manage` may publish or reject any agent draft from the `/knowledge-admin` queue. Rejecting archives the draft without ever publishing it.

For M3 debugging:

- Device and parameter reads require `debugging:view` and `debugging:read`.
- Debugging catalog administration requires `debugging:admin`; this governs parameter metadata, HDC/ADB node-binding changes, and debug node module tree CRUD (`/api/v1/debugging/admin/modules*`).
- Node writes require `debugging:write`, project access, an active session, a writable access mode, range validation, an active device lease for the session, and a pre-write snapshot.
- High-risk writes require `confirm-high-risk-write` or a future approval id.
- Snapshot rollback requires `debugging:rollback`, `confirm-rollback`, and an active device lease for the session.
- Bridge-backed sessions additionally require a user-owned, non-revoked, online device bridge and persist `execution_mode=bridge` plus `bridge_id` for audit and rollback continuity.
- DTS reload debugging requires `debugging:dts-reload`. Sensitive-node matches escalate as documented above (`parameter:edit-critical`, and `confirm-sensitive-reload` for critical). Agent actors (`actorType=agent`) are refused on start / deploy / restore / configure (#304). Device deploy additionally requires `confirm-dts-reload`, a device lease, bridge capability negotiation for `debug.mountTarget` / `debug.pushFile`, and a reload snapshot (ADR-0021). Deploy executes in-request on the process holding the bridge WebSocket (ADR-0020).
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

M1 parameter-management writes emit audit events from the backend for `parameter-submit`, `parameter-review-advance`, `parameter-review-reject`, `parameter-merge`, and `batch-import`. Module-attribution v2 writes additionally emit `parameter-module-mapping-created`, `parameter-module-mapping-deleted`, `parameter-module-compatible-dismissed`, `parameter-module-compatible-restored`, `parameter-module-driver-group-disbanded`, and `parameter-module-bindings-recomputed` (scoped mapping apply and ops recompute). Parameter-definition identity correction emits `spec-reattributed` and `spec-property-key-changed` with before/after identity and `reasonHash`. Organization Admins may correct org-owned definitions only; platform-global definitions require `platform-admin` — the same ownership split as deprecate/restore (ADR-0017 ID-R5). Node enablement writes on the shared topology draft pipeline emit `parameter-topology-governance` / `enablement-changed` with previous value, new value, reason, and logical node identity. Enablement uses the same `canEditParameters` gate and existing `dts_sensitive_node_rules` matching as binding edits (`parameter:edit-critical` when a rule requires it). The frontend audit drawer is not the security boundary; audit creation happens server-side with the authenticated actor and request trace id.

M2 log-analysis writes emit backend audit events for `log-upload`, `log-upload-failed`, `log-rerun`, `log-archive`, `log-unarchive`, and `log-feedback`. The UI may hide or disable actions by role, but the server permission check and audit write are the authoritative boundary.

Product feedback writes emit backend audit events for `product-feedback-create` and `product-feedback-update`. Audit metadata includes feedback type, status, page path, attachment count, and previous/next status for admin triage updates; attachment object bytes are not copied into audit metadata.

Knowledge base writes emit backend audit events for `knowledge-entry-create`, `knowledge-entry-update`, `knowledge-entry-publish`, `knowledge-entry-archive`, `knowledge-entry-restore`, `knowledge-revision-restore`, and `knowledge-entry-delete` (severity `High`). Phase 3 adds `knowledge-entry-distill` (draft distilled from a log analysis, metadata carries the source `logId`), `knowledge-entry-agent-draft` (`actorType=agent`, metadata carries the creating `sessionId` and optional `sourceLogId`), and `knowledge-entry-reject` (agent-draft archive-reject from the publish queue). Metadata carries content form, title, revision numbers, and lifecycle transitions with the request trace; extracted file text is not copied into audit metadata.

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

**Xiaoze P0 perception:** `perception.*` tools are read-only (`kind: read`, `requiresApproval: false`) and must pass the same `ToolRegistry.authorize` boundary as other Agent tools. Cross-page reads are bounded to the caller's project scope and permissions; out-of-scope tool calls return `FORBIDDEN` and the agent must answer with a safe non-data response. The AG-UI endpoint rejects unauthenticated requests before streaming events.

**Xiaoze P1 action:** `action.submitParameterChange` is mutating and approval-gated. The AG-UI runtime opens the orchestrator-owned Agent approval chain — `beginApproval` persists tool-call + approval records and emits the interrupt — and resumes only through `resolveApproval`, which re-authorizes inside a transaction and audits `actorType=agent`. Approval state is DB-backed (`agent_tool_calls` + `agent_approvals`), never process memory, so begin and resolve stay correct across restarts and replicas (ADR-0024). `editedArgs` fully replaces the tool payload before approval-time re-authorization and execution. On execution the tool follows the post-cutover semantic path: it creates a typed binding draft (schema-validated, write-locked) and submits with the draft identity through `submitParameterChanges` (`actorType: "agent"`); a failed submission deletes the agent-created draft. Before any draft is created, the tool runs the same sensitive-node guard as human writes: critical rule hits are denied immediately (`403`, `requireHuman: true`) and never create a production change request. Device write guards remain outside Xiaoze in P1.

**Xiaoze P2 planning:** Multi-step plans use a LangGraph `StateGraph` with a per-`threadId` checkpointer so approved mutating steps resume mid-plan without restarting perceived context. When `XIAOZE_CHECKPOINTER=postgres`, checkpoint payloads (including tool arguments and perceived context) persist at rest in PostgreSQL and must be protected by the same database access controls as other Agent tables; they are separate from user-visible chat history (TD-030). Resume commands carry only the approval decision (`approvalId`, `decision`, `editedArgs`, `reason`); request auth context flows through per-invoke configuration and is never placed in graph state or serialized into checkpoints (ADR-0024). Proactive suggestions are read-only, authz-bounded, and opt-in (`XIAOZE_PROACTIVE_ENABLED` / `VITE_XIAOZE_PROACTIVE_ENABLED`, default off). The suggest pass uses only `perception.*` tools via `POST /api/v1/agent/xiaoze/suggest` and never writes or proposes data outside the caller's permissions. Mutating writes in a plan still require per-step human approval through the existing orchestrator chain; rejecting a step halts the plan without mutation.

Agent-generated parameter changes may prepare drafts or recommendations, but production parameter writes still require a human-submitted draft/review path. Any future Agent/device write convergence must create an explicit approval record and then execute through the same server-side authz and audit boundary.

The live Xiaoze LLM uses LangChain `ChatOpenAI` against OpenAI-compatible `AGENT_API_*` configuration. Model output remains advisory until the WiseEff tool registry, authorization, approval, and audit paths accept it. Safe readiness evidence may expose model id and base URL configuration status; it must not expose API keys, Authorization headers, raw prompts, raw provider payloads, or customer data. Provider traces capture latency, token usage, estimated cost, safety status, safety reasons, and fallback reason so security review can distinguish grounded planning from degraded output.

Provider outages must not silently execute tools. A degraded assistant response is allowed only when the provider health check fails or the transport is unavailable, and the fallback path must skip tool execution entirely. Provider outages and device failures must leave audit/readiness evidence rather than silently passing.

### Log Analysis LLM (P1/P2)

The log analysis kernel behind `LogAnalysisAdapter` runs outside the Xiaoze stack (ADR-0022): it reuses only the `ChatOpenAI` client pattern against the separate `LOG_ANALYSIS_*` env family, with no LangGraph, no `ToolRegistry`, and no approval chain — because it has **no write path**. Its entire output is an advisory, evidence-grounded report; it never touches devices, parameters, or any mutating API. Since P2 the default kernel is a bounded agent loop over five **read-only** tools; the tools are plain internal worker functions, never registry entries, and every database-backed tool is bound to the organization id from the worker snapshot at the repository layer — the model cannot steer a query across tenants.

- **Untrusted input:** uploaded log content, retrieved knowledge-entry text (`read_domain_knowledge`), and parameter context (`get_related_parameter_context`) are untrusted model input — linking a knowledge entry to a log domain puts its text into prompts, which is the existing untrusted-input stance extended, not a new trust grant. The prompt instructs the model to never follow instructions found inside them, and structural controls do not rely on that instruction: every step's output is schema-validated strict JSON (tool call or final report), tool arguments are zod-validated with hard result truncation, and a grounding check drops any cited line number that does not exist in the parsed log. Output that cannot be grounded is discarded in favor of the deterministic rule fallback with an explicit degraded marker.
- **Published-only retrieval:** `read_domain_knowledge` inherits the knowledge base's published-only invariant in SQL — drafts and archived entries never enter analysis prompts, and domain links can only reference published entries (publishing stays the single trust gate, design D13).
- **Honest degradation:** provider failures ride the existing job retry/backoff; the final attempt falls back to the rule engine with `analysis_source = 'rules-fallback'` and a `degraded_reason`. The loop kernel's exhausted-budget early convergence stays marked (`degraded_reason = 'token-budget-exhausted'`, confidence capped). Degraded results never impersonate full analyses — the UI must keep the provenance badge visible.
- **Evidence discipline:** logs, audit, and metrics record model label, latency, token counts, degradation reason, and trace/request ids. They must never record API keys, raw prompts, raw provider payloads, or raw log content. `/health/ready` exposes `logAnalysisLlm` configuration status (mirroring `xiaozeLlm`), not credentials.
- **Tenant isolation:** the worker reads log bytes, log-domain rows, knowledge links, and parameter context through organization-scoped repository queries; log-domain governance (including knowledge links, webhook config, and the per-domain model override) requires `logs:admin-domains` and is audited (`log-domain-*`).

### Log Analysis Result Webhooks (P3b)

Domain result webhooks make the server issue outbound HTTP requests to admin-supplied URLs, so the URL is treated as untrusted input with hard anti-SSRF constraints:

- **Scheme and address policy:** `https:` only; URLs with embedded credentials are rejected; IP-literal hosts in private, loopback, link-local, CGNAT, benchmarking, multicast, reserved, or cloud-metadata ranges (`0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0.0/24`, `192.168/16`, `198.18/15`, `224/4`+, `::1`, `::`, `fc00::/7`, `fe80::/10`, `ff00::/8`, IPv4-mapped IPv6) are rejected. The same validation runs at configuration save (explicit `VALIDATION_FAILED` reason codes) and at delivery.
- **DNS-rebinding closure:** the delivery connection resolves hostnames through a validating lookup on the socket itself — every resolved address is checked against the blocked ranges and the connection is refused if any is blocked, so a hostname cannot re-resolve to a private address between validation and connect. Redirects are not followed; response bodies are discarded (only the status code is recorded); requests use a short timeout (`LOG_WEBHOOK_TIMEOUT_MS`, default 5s). `LOG_WEBHOOK_ALLOW_INSECURE_LOCAL=true` is a local-development flag that additionally permits loopback (`http://127.0.0.1`) receivers; server env validation refuses it in production.
- **Payload minimization:** deliveries carry a compact result summary (record/run ids, file name, status, provenance, severity, confidence, truncated conclusion, product link path). Raw log content, evidence text, and prompts are never sent; consumers fetch details through the authenticated API.
- **Authenticity and replay:** every delivery is signed with the domain's secret — `X-WiseEff-Signature: sha256=<HMAC-SHA256(secret, "timestamp.rawBody")>` next to `X-WiseEff-Timestamp`. The timestamp participates in the signed input (an unsigned timestamp would be rewritable, voiding replay protection); receivers verify with constant-time comparison inside a bounded replay window (docs/api/log-analysis-integration.md).
- **Secret handling:** the signing secret is stored server-side for HMAC use, is write-only at the API (responses and audit metadata carry only configured-state and the last four characters), and never appears in delivery records, logs, or metrics. Configuration changes and admin test deliveries are audited (`log-domain-webhook-config`, `log-domain-webhook-test`).
- **Blast-radius honesty:** delivery is best-effort and fully decoupled from the analysis result — webhook failures retry with bounded backoff, are recorded per attempt in `log_webhook_deliveries`, surface in `/log-admin` and metrics (`wiseeff_log_webhook_deliveries_total`), and never fail, retry, or delay the analysis job. The channel deliberately stays out of `/health/ready`.

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

The local bridge listens on loopback (`127.0.0.1:18787`) and its HTTP surface is intentionally split by CORS posture (decision TD-108, closed by decision B2). `/tools/install` is restricted to the paired origin allowlist (`[webOrigin, serverUrl]`). `/connect` keeps open CORS plus Private Network Access **by design**: it is the first-contact endpoint that lets any WiseEff origin ask an already-running bridge to connect, and its side effect is gated regardless of origin — `runConnectCommand` refuses to pair without a valid short-lived, single-use pairing code unless the bridge is already paired to the exact server named in the request, so an arbitrary web page cannot pair a bridge to an attacker-controlled server. `/health` also keeps open CORS so any WiseEff origin can detect a running bridge, but it **redacts identifying fields for non-allowlisted browser origins**: only the paired origin (allowlist match) or same-machine tooling (no `Origin` header) receives `bridgeId`, `serverUrl`, `launcherPath`, `tokenExpiresAt`, and tool state; every other browser origin receives liveness only (`{ ok, paired, connected, updatedAt }`). This keeps zero-friction presence detection while denying a page the operator merely visits the ability to fingerprint the bridge id, the paired server, or the operator's launcher filesystem path. The residual, accepted surface is a cross-origin liveness signal plus a CSRF-style reconnect trigger against the bridge's own already-paired server; it does not expose device-write authority, which always flows through authenticated, audited server routes.

Bridge rename (`PATCH /api/v1/device-bridges/:bridgeId`) and revoke (`POST /api/v1/device-bridges/:bridgeId/revoke`) require `debugging:use`, must target a user-owned bridge, and revoke immediately invalidates the bridge token for new WebSocket connections. Renaming updates display metadata only; it does not rotate credentials or grant additional scopes.

## Untrusted Subprocess Execution (DTS Validation Gate)

The P2 config-set baseline validation gate compiles user-supplied DTS content with the system `dtc` binary (`server/modules/parameter-files/dtcValidator.ts`). DTS content is untrusted input (uploaded/edited by project members), so the subprocess boundary must stay restricted:

- **Isolated temp directory**: each validation run writes files into a fresh `mkdtemp` directory that is removed in a `finally` block, including on spawn error, timeout, or an unexpected exception; validation never writes into a shared or predictable path.
- **Minimal environment**: the child process receives `PATH` plus present user-profile identity vars (`HOME`, `USER`, `LOGNAME`) via `minimalEnv()`, stripping API keys, database URLs, SSH agent sockets, and other process secrets from the environment `dtc` would otherwise inherit. Unset identity vars are omitted rather than invented.
- **Hard timeout**: every `dtc` invocation runs under a timeout (`DtcValidateOptions.timeoutMs`, default 10s) that sends `SIGKILL` to the child if exceeded, so a malformed or adversarial `.dts` file cannot hang the release/export path indefinitely.
- **No network assumption**: the sandbox does not provision or expect outbound network access for `dtc`; treat any future validator implementation that needs network access as a new threat-model review, not an incremental change.
- **Fixed argv, no shell interpolation**: file names and paths are passed as `spawn` argv elements, never interpolated into a shell string, so DTS file names cannot inject shell metacharacters.
- **Auditable degrade path**: when `dtc` is not on `PATH`, the validator degrades according to `DTS_VALIDATION_MODE` (`block` fails closed, `warn`/`off` pass with a recorded diagnostic) rather than silently skipping validation; every gate run, including degraded ones, writes a `validation.gate` audit event (see `docs/developer/environment-variables.md`).
- **Optional dt-schema hook**: when `DTS_ENABLE_DT_SCHEMA=1` (or `enableDtSchema`), the validator may merge diagnostics from an injected schema runner. Missing schema tools degrade to warning by default (`DTS_DT_SCHEMA_MODE=warn`); only `DTS_DT_SCHEMA_MODE=block` elevates unavailability to a hard error.
- **Production fail-closed toolchain (baseline release / Admin validate)**: release-mode toolchain validation (`dtc` + `fdtoverlay` + `dt-validate`) applies to **baseline release gates and Admin `validateConfigRevision` assist**, not everyday semantic merge/writeback. Production must not bypass those L2 gates. API and CLI gates share the project/managed binary resolver; invalid explicit paths fail closed, and runtime never auto-installs tools. Bypass is a critical alert (`WiseEffConfigPublishValidationBypass`). Semantic identity cutover is maintenance-only with whole-snapshot restore — see `docs/runbooks/parameter-identity-cutover.md`. Migration evidence preserves legacy IDs/values without promoting `recommended_value` into schema default or policy. **TD-042 remains BLOCKER** until clean non-customer snapshot rehearsal completes.
- **Containerized sandbox evaluation (TD-040 / B5)**: **not implemented this period**. Assessment remains: keep the restricted OS subprocess (`tmpdir` + minimal env + hard timeout + fixed argv) as the default isolation boundary. A container/gVisor sandbox for `dtc` is deferred to a separate initiative if threat modeling later requires stronger isolation than the current subprocess controls.

**Export data classification:** `exportFile`/`exportConfigSet` return the same DTS/JSON parameter content that is already stored per-project (not credentials, tokens, or cross-tenant data), so export responses carry the same project-scoped sensitivity as the source parameter files and require `admin:access` like the rest of the config-set/baseline surface. Export bundles are returned in the HTTP response body for the caller to hand-commit to Git; they are not written to a shared or public location by the backend, and callers that persist exported bundles are responsible for applying the same access control as the source repository.

## References

- `design-docs/security-governance.md`
- `design-docs/domain-model.md`
- `design-docs/api-contract.md`
- `security/README.md`
- `runbooks/identity-provider.md`
