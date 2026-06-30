# WiseEff Security And Governance Design

> Chinese: [Chinese](../zh-CN/design-docs/security-governance.md)

Date: 2026-05-25

## Goals

WiseEff handles parameters, logs, device debugging, and AI tool calls. These workflows can affect real engineering systems, so identity, authorization, audit, confirmation, and isolation are default requirements.

## Identity And Authorization

Enterprise environments should use OIDC/SSO. Local development may use development or smoke identity modes. Page visibility is not a security boundary. Backend write APIs must authorize actions server-side, validate project or organization boundaries, and preserve audit.

## Audit

Login/identity events, user and role changes, parameter writes, review decisions, log uploads and reruns, device reads/writes/rollback, Agent tool calls, approvals, and configuration changes need audit.

## Agent And Device Safety

Agent output cannot directly become a business write. Tool payloads require schema validation, approvals must be recorded before mutating actions, and execution must re-check permissions and current business state.

Xiaoze uses LangChain `ChatOpenAI` against OpenAI-compatible `AGENT_API_*` configuration. Model output remains advisory until the WiseEff tool registry, authorization, approval, and audit paths accept it. Safe readiness evidence can identify model id and base URL configuration status, but keys, raw prompts, raw provider payloads, and customer data must stay out of evidence.

Device writes require permissions, device state checks, access-mode checks, range/risk checks, confirmation, snapshot preparation, readback handling, and audit. The device gateway should not be exposed publicly.

## Data Protection

Logs and parameters may contain sensitive data. Uploads need size/type controls, storage isolation, redaction where appropriate, short-lived access, retention policy, encrypted backups, and secret hygiene.
