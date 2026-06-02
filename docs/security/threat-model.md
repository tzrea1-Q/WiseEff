# Threat Model

This threat model focuses on the current WiseEff productization baseline and the next controlled pilot stage.

## Assets

- PostgreSQL business state.
- Audit events and request traces.
- Uploaded logs and object-storage files.
- Parameter definitions, project values, drafts, reviews, and history.
- Debugging sessions, node operations, snapshots, and rollback records.
- Agent sessions, messages, tool calls, approvals, and provider traces.
- Runtime secrets and bearer tokens.

## High-Risk Paths

| Path | Risk | Control |
| --- | --- | --- |
| Parameter write | unauthorized value change | server-side authz, validation, review workflow, audit |
| Log upload | sensitive data exposure or parser failure | object-store boundary, failure records, audit, retention policy |
| Device write | unsafe physical/device state change | device lease, range/access validation, confirmation, snapshot, readback, audit |
| Agent mutating tool | model bypasses governance | backend tool registry, approval record, approval-time authz, audit |
| Production auth | forged identity | target production requires OIDC/JWKS; local HMAC remains smoke/test only; issuer/audience/subject/org/role validation |
| Object storage | lost or leaked file bytes | checksum metadata, scoped keys, provider access policy, backup/restore drill |

## STRIDE Summary

| Category | Main concern | Current mitigation |
| --- | --- | --- |
| Spoofing | forged user or org | production-mode bearer token verification |
| Tampering | changed parameter/device value | transactions, review state, snapshots, readback |
| Repudiation | user denies action | audit events with request trace |
| Information disclosure | logs or prompts leak sensitive data | object-store boundary, no secrets in docs, future data classification policy |
| Denial of service | worker/provider/device outage | readiness, failed job states, fallback without tool execution |
| Elevation of privilege | UI-only permissions bypassed | backend authz and negative tests |

## Pilot Gaps

- OIDC/JWKS verifier and frontend token-provider seam exist, but target-environment Keycloak/OIDC evidence is still required before TD-020 can close.
- Target-environment HDC evidence is still required.
- Backup/restore and rollback evidence must be collected outside local simulator checks.
- Provider safety evidence must be collected with the live provider configuration.
