# ADR-0031: The Xiaoze wire contract is a shared package

- Status: Accepted
- Date: 2026-08-13

## Context

The Xiaoze AG-UI stream carries five CUSTOM event families (`xiaoze_turn_state`, `xiaoze_turn_reply`, `xiaoze_run_timing`, `xiaoze_prompt_debug`, `on_interrupt`). Their names and payload shapes were maintained twice by hand: once on the emitting side (`server/modules/agent/xiaoze/`) and once as frontend mirror files (`src/features/agent/xiaoze*Types.ts`). The run-step shape alone was declared four times, and the copies had already drifted (citation `type` strictness, missing `promptVersion`, three names for the same step record). Because the consuming side narrowed defensively, drift degraded silently instead of failing.

## Decision

Event names and payload types live once, in the workspace package `@wiseeff/xiaoze-protocol` (`packages/xiaoze-protocol`). Both sides import the package; the frontend mirror files and the server-side duplicate declarations are deleted, not re-exported. The step record has one name — `XiaozeRunStep` — across server, frontend, and wire. The server's `AgentCitation` is a type alias of the contract's `XiaozeCitation`.

The package contains **shapes only**. Classification heuristics (`splitAssistantContent`, reasoning prefix lists), rendering adjudication, and frame construction stay on their own side of the wire: sharing behavior is a separate decision with its own behavioral risk, and the contract must stay dependency-free.

## Consequences

- A payload change is an edit to one package that both compilers see; hand-copied drift between the two sides is structurally impossible for the covered events.
- The frontend now compiles against the emitter's real strictness (e.g. citation `type` is the server enum), so fixture data that used to rely on defensive widening must be honest.
- New Xiaoze CUSTOM events must add their name and payload to the package first; reviewers should reject inline event-name strings on either side.
- The frontend fallback tool-label table remains (labels are not wire payloads today); shipping labels inside frames can retire it later without touching this contract's shape-only rule.
