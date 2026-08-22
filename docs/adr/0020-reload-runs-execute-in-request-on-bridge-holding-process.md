# ADR-0020: Reload runs execute in-request on the bridge-holding process

- Status: Accepted
- Date: 2026-08-10

## Context

Long-running work in WiseEff usually goes through BullMQ so HTTP handlers stay short and workers can retry. A DTS reload deploy, however, must call the engineer's **local device bridge** over the live WebSocket held by the API process's connection pool. Worker processes do not share that pool and cannot reach the bridge that accepted the user's pairing.

## Decision

Reload deploy and trigger execute **in-request** on the API process that holds the bridge WebSocket. They are not enqueued on BullMQ. Persistence still records per-step statuses so a later move to asynchronous execution needs no data reshaping, but the current execution affinity remains the process with the socket.

The stock self-hosted topology supports **exactly one API replica**. For `up --scale api=...`, `up --scale=api=...`, and the standalone `scale api=...` command, its `ops/self-hosted/scripts/compose` entry accepts only exact `api=1` and rejects every other `api=*` value before invoking Docker; scaling unrelated services remains valid. Calling Compose directly bypasses this executable guard but does not make a multi-API topology supported.

Any direct Compose, orchestrator, or external deployment with multiple API replicas is unsupported for local-device-bridge workflows unless it provides bridge-aware routing that keeps both the WebSocket and every later bridge-backed HTTP request on the process holding that socket. Such custom routing is outside the stock deployment contract and requires its own target-environment evidence; this ADR does not claim HA or multi-replica readiness.

## Consequences

- Stock deployments run one API replica. Non-bridge-aware multi-replica deployments are unsupported, even if ordinary non-bridge API traffic appears healthy.
- Request timeouts and per-RPC `timeoutMs` values must cover mount/transfer/trigger (bridge clients ignore `deadlineAt`).
- A well-intentioned refactor that moves deploy into a worker, or an operator bypass that adds API replicas without bridge-aware routing, will fail bridge-backed requests intermittently unless bridge affinity is redesigned first.
