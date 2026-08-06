# ADR-0018: Uploaded file versions are staged before activation

- Status: Accepted
- Date: 2026-08-06

## Context

Project files are members of a config set's working configuration, and release baselines snapshot the active member versions. Activating a version at upload time makes a transport action silently change the content that the next baseline will release, before an Admin can inspect parsing results, structural differences, coverage changes, or conflicts.

## Decision

Uploading creates a **candidate file version**. The system parses it and presents its source and structural difference from the current version, together with coverage and conflict impact. Only an explicit activation promotes the candidate to the working configuration. Adding a new file also requires an explicit member role and config-set assignment; upload alone never changes releasable composition.

## Consequences

- Candidate versions need an explicit lifecycle and API operations for inspection, activation, and abandonment.
- Failed or abandoned candidates do not change the current working configuration and remain distinguishable from version history that was previously active.
- Activation is audited and recomputes release readiness; the prior active version stays available through version history.
- Source upload, candidate activation, baseline creation, and baseline release remain four distinct acts.

## Alternatives considered

- **Activate immediately after upload:** rejected because a routine file transfer would mutate the next release without an impact review.
- **Upload and activate in one confirmation:** rejected because parsing and structural comparison must complete before the operator can make an informed confirmation.
