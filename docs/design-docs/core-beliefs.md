# WiseEff Core Beliefs

> Chinese: [Chinese](../zh-CN/design-docs/core-beliefs.md)

## 1. Repository Knowledge Is The System Of Record

WiseEff should be understandable from the repository itself. Product decisions, architecture boundaries, operating constraints, and plans belong in versioned docs, schemas, tests, and code.

Implication: if a future agent needs a decision to act correctly, store that decision in the closest durable document.

## 2. Agents Need Maps, Not Manuals

`AGENTS.md` should remain short. It points to deeper docs, and those docs point to narrower artifacts. This lets agents load only the context needed for a task.

Implication: avoid turning one file into the encyclopedia. Prefer indexed, purpose-specific files.

## 3. Boundaries Create Speed

WiseEff has several risky domains: parameters, logs, device writes, Agent tool calls, permissions, and audit. Fast work depends on stable boundaries, not on everyone remembering every caveat.

Implication: put durable rules behind ports, DTOs, state machines, permissions, tests, and audit trails.

## 4. Mock Mode Is A Tool, Not A Product Path

The prototype depends on mock data for demo velocity. Production development must preserve the demo path while moving real workflows through backend APIs and persistent state.

Implication: when adding productized behavior, keep mock and API implementations legible and prevent production builds from relying on mock business data.

## 5. AI Helps, Humans Approve Risk

Agent assistance can summarize, recommend, draft, and prepare actions. It must not silently execute production-changing operations.

Implication: Agent write tools, parameter merges, log archive actions, and device writes need permissions, approval, validation, and audit.

## 6. Quality Is Measured At Workflow Boundaries

Unit tests matter, but WiseEff is only useful if full workflows are safe: parameter changes, log analysis, device debugging, and Agent approvals.

Implication: each milestone needs acceptance checks at the user workflow level, plus lower-level tests for domain rules and contracts.

## 7. Pay Down Drift Continuously

Agent-assisted development increases throughput and can also replicate stale patterns. Small recurring cleanup is cheaper than large reorganizations.

Implication: maintain `docs/exec-plans/tech-debt-tracker.md`, update `docs/QUALITY_SCORE.md`, and convert repeated review feedback into tests or docs.
