# Durable Queue Runbook

M6.4 adds Redis/BullMQ as the durable transport for log-analysis dispatch. PostgreSQL remains the source of truth for job state, leases, retries, dead-letter metadata, audit, and generated evidence.

## Runtime Shape

- API process in durable mode creates a BullMQ `log-analysis` queue for enqueue and readiness.
- Worker process in durable mode creates a BullMQ worker that consumes queue payloads by `jobId`.
- The worker always claims the PostgreSQL job by id before processing. Duplicate queue delivery is safe because completed jobs cannot be claimed again.
- If PostgreSQL schedules a retry, the BullMQ handler throws so BullMQ redelivers according to `LOG_ANALYSIS_QUEUE_ATTEMPTS` and `LOG_ANALYSIS_QUEUE_BACKOFF_MS`.
- Database polling remains available with `LOG_ANALYSIS_QUEUE_MODE=polling` for local development and as a compensation path during incidents.

## Required Configuration

```text
LOG_ANALYSIS_QUEUE_MODE=durable
REDIS_URL=redis://redis:6379
LOG_ANALYSIS_QUEUE_PREFIX=wiseeff
LOG_ANALYSIS_QUEUE_ATTEMPTS=4
LOG_ANALYSIS_QUEUE_BACKOFF_MS=1000
LOG_ANALYSIS_QUEUE_CONCURRENCY=1
```

Self-hosted API containers should run with `LOG_WORKER_ENABLED=false`; the dedicated worker service runs `npm run worker:logs`.

## Verification

Run metadata and target checks:

```bash
npm run selfhost:check
npm run queue:check -- --base-url https://<host>
npm run selfhost:smoke -- --base-url https://<host> --allow-only-blocked=deviceGateway
```

`queue:check` requires `/health/ready` to include `dependencies.durableQueue.transport` and `dependencies.durableQueue.database` with `status=ready`.

Focused local tests:

```bash
npm test -- server/modules/jobs/bullmqQueue.test.ts server/modules/jobs/queueHealth.test.ts
npm test -- server/modules/logs/logAnalysisQueueRuntime.test.ts server/modules/logs/worker.test.ts server/modules/logs/workerRunner.test.ts
```

## Operations

Pause queue dispatch only during controlled maintenance:

1. Stop the API or block log upload routes at the proxy.
2. Let current worker jobs finish or stop the worker after checking active jobs.
3. Inspect `/health/ready` for durable queue and PostgreSQL job-state status.
4. Resume API traffic and worker processing together.

For Redis outage:

1. `/health/ready` should report `durableQueue.status=failed`.
2. Stop creating new log-analysis jobs if the outage is not brief.
3. Restore Redis from the self-hosted persistence backup procedure.
4. Run `npm run queue:check -- --base-url https://<host>`.
5. Confirm PostgreSQL job-state health is ready and no unexpected dead-letter backlog exists.

For dead-letter review:

1. Check `/health/ready` for `durableQueue.database.deadLettered`.
2. Use the jobs/admin APIs or database inspection to identify failed `log-analysis` jobs.
3. Record the failure reason, object-store status, and run id before retrying.
4. Retry through the product rerun flow when possible so audit and run history stay coherent.

## Evidence Rule

Local unit tests prove the adapter and worker semantics. A target environment is not considered queue-ready until `queue:check` and `selfhost:smoke` pass against the deployed API and Redis instance.
