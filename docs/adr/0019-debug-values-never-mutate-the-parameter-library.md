# ADR-0019: Debug values never mutate the parameter library

- Status: Accepted
- Date: 2026-08-10

## Context

DTS reload debugging lets an engineer try candidate parameter values on hardware by generating a debug overlay from the project's parameter library. A natural temptation is to write a value that "worked on device" straight back into the binding revision, working configuration, draft, or release baseline. The retired M1 **parameter reload** surface did exactly that — it wrote the accepted value back into project parameter values — and its data model was wrong for this problem.

## Decision

A **debug value** is run-scoped evidence only. Starting or completing a reload run must not mutate binding revisions, working configuration membership/versions, parameter drafts, change requests, or release baselines. Promoting a proven debug value into the library is a separate, governed change request outside this surface.

## Consequences

- Reload runs read the library as a baseline and persist their own target rows plus overlay artifacts.
- Tests for the run skeleton assert a library fingerprint is unchanged across a run.
- Future "send proven value to change request" work must not collapse into the reload write path.
