# Signed Hosted admission for isolated PostgreSQL components

Chinese: [中文](upgrade-hosted-admission.zh-CN.md)

This module establishes one additional development-runner admission path. It does not approve a deployment, database migration, recovery, application startup, queue resumption, or public traffic. The existing Docker endpoint guard, repeated daemon checks, fresh resource creation, ownership labels and cleanup checks remain required. Local Docker Desktop admission remains a separate path.

## Trust contract and ownership

`upgrade-hosted-admission.ts` requests its token itself and retrieves signing keys from the fixed official GitHub JWKS endpoint. It accepts no caller token, JWKS, serialized approval, `CI` boolean, or test switch. `node:crypto` performs RSA signature verification; `node:https` requires certificate verification explicitly, disables redirects by construction, and bounds each request to 10 seconds and 256 KiB. Application OIDC authentication is a separate private module with user-governance mapping and is not reused or modified.

The issuer is `https://token.actions.githubusercontent.com`, the repository is `tzrea1-Q/WiseEff`, and the workflow file is `.github/workflows/ci.yml`. The entire `workflow_ref` must equal the current expected workflow reference. Only branch references or pull-request merge references are supported. Signed claims must also match the actual checkout SHA, run ID and run attempt, and declare `runner_environment=github-hosted`. Tokens must be currently valid, issued within ten minutes, and have a validity interval no longer than ten minutes. RS256 and a unique compatible RSA signing key of at least 2048 bits are required.

Each issuance uses a fresh random nonce and an audience digest binding all observed facts, including daemon identity. This digest does **not** discover or independently prove a Docker identity. The component runner must first obtain the daemon identity from `createIsolatedUpgradeDocker`, which rejects remote endpoints, and the checkout SHA from Git. The runner repeats these observations using the mandatory `observeCurrent` callback after token verification. Run/workflow environment values are expectations, never authority without matching signed claims.

The module returns a frozen, process-local `new-owned-pg-components` capability. `assertHostedUpgradeAdmission` checks its original object identity, expiration and current facts. Copying or serializing it loses authority. Call this assertion immediately before creating owned resources; continue the existing Docker guard on every Docker call. Later cleanup still requires resource ownership checks and must remain possible after the admission expires. Do not use this module for general Docker commands or backup consumption.

## Threat and acceptance matrix

| Threat | Rejection or retained boundary |
| --- | --- |
| Caller fabricates Hosted environment values | Official TLS-fetched JWKS and valid signature required |
| Self-hosted runner, wrong repository/workflow/SHA/run/attempt | Signed claim equality rejects |
| Token copied across requests or daemon identities | Fresh audience challenge and post-request observation reject |
| Expired, future or stale token; copied capability | Time checks and private WeakSet reject |
| Untrusted endpoint, redirect, timeout, huge body, TLS failure | No credential forwarding; bounded generic error |
| Resource drift after admission | Existing per-call daemon checks and owned-resource checks remain mandatory |
| Receipt reused as restore or release permission | Scope is only newly created owned PG component resources |

Failures contain fixed reason codes, not request URLs, tokens, request bearers, raw transport errors or remote bodies. No token is written to a file, log, receipt, or artifact.

## Integration and evidence boundary

The parent component-runner owner supplies observed facts, narrow OIDC request environment fields, and a synchronous re-observer, then consumes the in-memory capability. The GitHub job requires `id-token: write` solely to request the signed token. Workflow and shared runner wiring are separate changes. A runner must not manufacture successful evidence when GitHub withholds OIDC permission, including restricted fork workflows.

Run the synthetic tests from an isolated development checkout:

```sh
./node_modules/.bin/vitest run --config vitest.scripts.config.ts scripts/upgrade-hosted-admission.test.ts
```

The tests use synthetic RSA keys and a controlled HTTPS response seam. They exercise real cryptographic verification and error behavior, but do not establish real GitHub issuance, Hosted Docker isolation, or an actual certificate handshake. Real Hosted execution remains a separate required result; no production command is supplied here.

Sources verified on 2026-09-07: [GitHub OIDC claims and token requests](https://docs.github.com/en/actions/reference/security/oidc), [official issuer discovery](https://token.actions.githubusercontent.com/.well-known/openid-configuration). These establish the issuer, JWKS, RS256, custom audience, runner environment and workflow/run claims; the narrower component-only policy above is local to this module.
