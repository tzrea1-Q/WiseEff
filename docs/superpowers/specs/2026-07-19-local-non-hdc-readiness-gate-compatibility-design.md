# Local non-HDC Readiness Gate Compatibility — Design Specification

> Chinese: [中文](../../zh-CN/superpowers/specs/2026-07-19-local-non-hdc-readiness-gate-compatibility-design.md)

**Date:** 2026-07-19

**Status:** Design approved in brainstorming; written-spec review pending

**Scope:** Local non-HDC acceptance preflight evaluation only

## 1. Problem

The pilot-readiness API now exposes the canonical gate name `xiaozeLlm`, but
`scripts/run-acceptance-preflight.ts` still recognizes the retired
`agentProvider` name in the two local-only blocker combinations. A healthy local
API therefore reports the expected blockers:

```text
deviceGateway, xiaozeLlm, backups
```

and the preflight incorrectly rejects the run before browser acceptance starts.
This is a consumer/provider contract drift. It does not mean those three gates
are pilot-ready.

## 2. Decision

Use the pilot-readiness API contract as the source of truth and replace the
retired `agentProvider` checks with `xiaozeLlm` in local non-HDC evaluation.

The accepted local-only outcomes are exactly:

1. `deviceGateway`;
2. `deviceGateway + xiaozeLlm` when preflight starts the local runtime; or
3. `deviceGateway + xiaozeLlm + backups` when preflight starts the local runtime.

Each accepted combination produces `outcome=non_hdc_local`. It never produces
`pilot_ready`. `--require-pilot-ready`, `--no-start-runtime`, unknown blockers,
and every target/full-pilot path remain strict.

The legacy `agentProvider` name will not be accepted as an alias. Rejecting it
surfaces stale server or client contracts instead of hiding another drift.

## 3. Alternatives

### 3.1 Recommended: update the consumer to the canonical gate

Change only the evaluator, its tests, and the paired acceptance documentation.
This preserves the existing local policy and keeps target/full-pilot semantics
unchanged.

### 3.2 Accept both old and new names

This would preserve compatibility with stale local APIs, but it makes contract
drift invisible and could keep obsolete deployments appearing valid. Rejected.

### 3.3 Satisfy every pilot gate before local browser acceptance

This requires real device-lab, live LLM, and backup/restore evidence. Those are
required for full pilot readiness but are intentionally not prerequisites for a
local non-HDC browser run. Rejected for this task.

## 4. Data flow and safety boundary

```text
/api/v1/operations/pilot-readiness
  -> blockedBy canonical gate names
  -> evaluatePilotReadiness
  -> exact local-only allowlist
  -> non_hdc_local
  -> standard browser acceptance
```

The evaluator remains fail-closed for extra or unknown gates. The generated
preflight and browser evidence must explicitly retain the blocked gate list and
the `non_hdc_local` outcome. No environment variable or evidence file will be
invented to mark device, LLM, backup, or TD-042 readiness.

## 5. Verification design

Test-driven implementation will first add failing evaluator tests for:

- `deviceGateway + xiaozeLlm` accepted only for an auto-started local runtime;
- `deviceGateway + xiaozeLlm + backups` accepted under the same condition;
- the legacy `agentProvider` combinations rejected;
- `--require-pilot-ready` and `--no-start-runtime` remaining strict; and
- an unexpected additional blocker remaining rejected.

After the minimal change, run the focused test, the complete preflight test,
documentation/contract/build/test gates, and then:

```bash
npm run acceptance:preflight
npm run acceptance:browser -- --mode local-non-hdc
npm run acceptance:evidence
```

The browser run must not use `--skip-preflight`. Any later Playwright failure is
reported and debugged separately; this change does not weaken browser, API,
operation-evidence, or coverage assertions.

## 6. Documentation impact

Update the separate English and Chinese manual-acceptance documentation so the
local deterministic dependency is called `xiaozeLlm`, matching the API
contract. Record the implementation and evidence in the existing Round6 active
plan without changing TD-042 or production-readiness statements.
