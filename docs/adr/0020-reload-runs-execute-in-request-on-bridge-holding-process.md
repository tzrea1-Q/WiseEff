# ADR-0020: Reload runs execute in-request on the bridge-holding process

- Status: Accepted
- Date: 2026-08-10

## Context

Long-running work in WiseEff usually goes through BullMQ so HTTP handlers stay short and workers can retry. A DTS reload deploy, however, must call the engineer's **local device bridge** over the live WebSocket held by the API process's connection pool. Worker processes do not share that pool and cannot reach the bridge that accepted the user's pairing.

## Decision

Reload deploy and trigger execute **in-request** on the API process that holds the bridge WebSocket. They are not enqueued on BullMQ. Persistence still records per-step statuses so a later move to asynchronous execution needs no data reshaping, but the current execution affinity remains the process with the socket.

## Consequences

- Multi-replica deployments already require sticky routing for bridge connections; reload deploy inherits that constraint rather than introducing a new one.
- Request timeouts and per-RPC `timeoutMs` values must cover mount/transfer/trigger (bridge clients ignore `deadlineAt`).
- A well-intentioned refactor that moves deploy into a worker will fail intermittently under multi-replica unless bridge affinity is redesigned first.
