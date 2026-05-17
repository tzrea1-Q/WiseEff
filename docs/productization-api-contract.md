# WiseEff Productization API Contract Draft

Date: 2026-05-16

## Scope

Backend readiness for frontend productization; current runtime remains mock-backed.

## Parameters

Endpoints:

- `GET /api/projects`
- `GET /api/parameters`
- `GET /api/parameter-change-requests`
- `GET /api/parameter-submission-rounds`
- `POST /api/parameter-submission-rounds`

Database entities:

- `Project`
- `ParameterRecord`
- `ParameterHistoryEntry`
- `ChangeRequest`
- `ParameterSubmissionRound`
- `ParameterSubmissionItem`

## Log Analysis

Endpoints:

- `GET /api/logs`
- `GET /api/logs/:logId`
- `POST /api/logs`
- `POST /api/logs/:logId/archive`
- `POST /api/logs/:logId/unarchive`

Database entities:

- `LogRecord`
- `LogEvidence`
- `LogAnalysisRun`
- `LogAnalysisStage`
- `LogArchiveState`

## Debugging

Gateway operations:

- `detectTargets`
- `readNode`
- `writeNode`

Database entities:

- `Device`
- `DebugParameter`
- `DebugSnapshot`
- `DebugSnapshotEntry`
- `DebugEvent`
- `NodeOperation`

## Agent

Gateway operations:

- `startSession`
- `sendMessage`
- `runAction`
- `approveToolCall`

Tool Governance: agent tool calls must be scoped by page context, user role, and project. Read-only tools may run automatically when they do not cross permission boundaries. Mutating tools, device writes, archive operations, and parameter submission actions must produce an approval record and wait for `approveToolCall` before execution.

## Error Model

- `UNAUTHENTICATED`
- `FORBIDDEN`
- `NOT_FOUND`
- `VALIDATION_FAILED`
- `CONFLICT`
- `PROCESSING`
- `AGENT_TOOL_FAILED`
- `DEVICE_UNAVAILABLE`

## Index Guidance

- Index `ParameterRecord.projectId`, `ParameterRecord.module`, and `ParameterRecord.risk` for parameter workbench filtering.
- Index `ChangeRequest.submissionRoundId`, `ChangeRequest.projectId`, `ChangeRequest.parameterId`, and `ChangeRequest.status` for review queues.
- Index `ParameterSubmissionRound.projectId`, `ParameterSubmissionRound.createdAt`, and `ParameterSubmissionRound.status` for submission timelines.
- Index `LogRecord.projectId`, `LogRecord.status`, `LogRecord.severity`, `LogRecord.capturedAt`, and `LogRecord.updatedAtIso` for log dashboards.
- Index `LogEvidence.stageId` and `LogEvidence.ruleHit` for evidence drilldowns.
- Index `Device.projectId`, `Device.status`, and `Device.lastSeen` for debugging target selection.
- Index `DebugParameter.projectId`, `DebugParameter.module`, `DebugParameter.nodePath`, and `DebugParameter.risk` for node lookup and write planning.
- Index `DebugEvent.deviceId`, `DebugEvent.snapshotId`, and `DebugEvent.at` for operation history.
- Index `AgentSession.context.pageKey`, `AgentSession.context.projectId`, and `AgentSession.context.roleId` for scoped assistant sessions.
- Index `AgentToolCall.sessionId`, `AgentToolCall.name`, and `AgentToolCall.requiresApproval` for governance and audit review.
