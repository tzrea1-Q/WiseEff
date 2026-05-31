# Security Docs

Security documentation describes how WiseEff protects identity, authorization, audit evidence, Agent tools, device writes, and operational secrets.

## Reading Order

1. [SECURITY.md](../SECURITY.md): current security baseline and non-negotiables.
2. [Threat Model](threat-model.md): practical risks and controls.
3. [Data Classification](data-classification.md): data classes and handling rules.
4. [Secrets Management](secrets-management.md): secret ownership, rotation, and local examples.
5. [Audit Retention](audit-retention.md): audit coverage and retention guidance.
6. [User Permission Design](user-permission-design.md): role inclusion, workflow slot eligibility, and dropdown filtering rules.
7. [Security Governance Design](../design-docs/security-governance.md): deeper design context.

## Rule

Frontend visibility controls are not security boundaries. Production writes must be rejected or accepted by backend authz, validation, transaction, and audit logic.
