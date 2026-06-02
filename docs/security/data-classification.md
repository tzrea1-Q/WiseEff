# Data Classification

WiseEff handles engineering workflow data. Treat data according to the highest-risk object it can affect.

## Classes

| Class | Examples | Handling |
| --- | --- | --- |
| Public docs | repository README, product overview | can be committed when reviewed |
| Internal workflow data | parameters, drafts, reviews, log reports | store in PostgreSQL, protect with authz and audit |
| Operational evidence | readiness JSON, smoke output, backup timestamps, M6 backup/restore summaries | can be committed only after redacting secrets and customer data |
| Sensitive engineering data | uploaded logs, device node values, provider prompts | keep in controlled storage; commit only synthetic samples |
| Secrets | API keys, HMAC secrets, object-store credentials | never commit; use `.env` or secret manager |

## Repository Rules

- Commit `.env.example`, never `.env`.
- Commit synthetic test fixtures only.
- Do not commit real customer logs, provider prompts, HDC device identifiers, or access keys.
- Redact bearer tokens unless they are explicitly local sample tokens generated for `.env.example`.
- Do not commit database dumps, restored database contents, object bytes, or raw customer log exports as backup evidence.

## Audit Evidence

Audit evidence may include actor, target, action, severity, metadata, trace id, timestamp, and scope. It should prove what happened without exposing unnecessary raw payloads.
