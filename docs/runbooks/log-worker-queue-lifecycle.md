# Log worker Redis lifecycle

> Chinese: [中文](../zh-CN/runbooks/log-worker-queue-lifecycle.md)

This component owns the connections created by `createLogAnalysisQueueRuntime`
and the API-only `createLogAnalysisQueueTransport`.
It does not authorize Catalog startup, publish a deployment, or resume a paused
business queue. Both factories are asynchronous; callers must await them before
starting their dependent services. The transport starts no Worker.

## Connection and shutdown contract

The worker uses `autorun: false`. Both Queue and Worker must finish BullMQ's
actual `waitUntilReady` before consumption starts. The supplied Redis URL is
forwarded through BullMQ's URL-aware connection adapter; there is no ambient
`REDIS_URL` fallback in the isolated test. Authentication, connection, and
asynchronous readiness failures return `PCAT-LOG-QUEUE-INITIALIZATION-FAILED`.
Already-created resources are closed before this refusal returns.
The API-only transport uses the same connection compatibility and error observer,
waits for Queue readiness, and shares the same idempotent shutdown contract.

Queue and Worker error listeners remain installed through shutdown. A recoverable
running connection error produces only `PCAT-LOG-QUEUE-CONNECTION-ERROR`; it does
not permanently invalidate a later successful reconnect. An error emitted during
close makes close fail with `PCAT-LOG-QUEUE-CLOSE-FAILED`, including when BullMQ
internally catches that error and resolves its own close promise. Concurrent or
repeated close calls share one result. Normal close waits for the active BullMQ
task; it does not force-cancel business work. Direct constructor/cleanup throws
retain the existing error precedence; the environment composition root owns
their public diagnostic redaction.

## Locked dependency compatibility

The inspected version is BullMQ 5.78.0. Its `RedisConnection.close` removes event
listeners before a still-pending initialization rejection handler can emit its
error. `DrainingRedisConnection` waits for initialization to settle after
disconnecting its own initializing client, then calls the native close. The
Queue's public ready client creates a separately owned Worker connection through
`duplicate({ maxRetriesPerRequest: null })`. Its public duplicate method registers
the additional blocking client before BullMQ uses it. Failure disconnects and
settles owned clients before native cleanup; normal shutdown first drains the
Worker and then closes the explicitly owned connections. No Worker private member
is read. Only the RedisConnection subclass accesses its own protected `_client`;
its private initialization promise is never accessed. Recheck this dependency
contract when changing BullMQ.

ioredis's callback-form INFO readiness failure otherwise prints a raw server
diagnostic and can skip its readiness check for NOPERM. The owned client INFO
method preserves the actual command and loading checks, but returns a static
readiness error in both callback and promise forms. No ready/version check is
disabled, no global console/error handler is replaced, and no dependency file or
grant is changed.
Malformed URI escapes are rejected before client allocation. Permanent production
mode subprocess regressions check static refusal and absence of unhandled
rejections for both factories.

## Threat and evidence matrix

| Boundary | Required observation |
| --- | --- |
| Unready connection | No consumer until both readiness promises settle |
| Bad authentication or stopped owned Redis | Static refusal; no job invocation; connections closed |
| Authenticated principal denied INFO | Static refusal; no raw principal/password diagnostic or unhandled rejection |
| Active task during close | Close remains pending until the actual processor returns |
| BullMQ catches close error and emits it | Application close rejects; private canary is absent from console output |
| Dropped TCP connections | A subsequent real BullMQ job executes; later close succeeds |
| Repeated close | Shared completion, no repeated resource close |
| Test target/cleanup | Independently pinned daemon and individually owned container/network/volume; no remaining labeled resources |

The real Redis suite is
`server/modules/logs/logAnalysisQueueRuntime.redis.integration.test.ts`. It uses
the existing isolated Docker guard, a new nonce, the locally inspected
`redis:7-alpine` image, AOF, a loopback-only published port and a bridge without
outbound masquerading. A private directory and mode-0600 configuration carry a
random test password. The fixture runs Redis directly so that its private mounted
configuration remains readable without widening host permissions; it is not a
claim about the production container's Unix user. Cleanup removes only resources
whose exact identity and run label still match, and checks the remaining inventory.

The processor is an explicitly injected controlled promise, while Queue, Worker,
Redis authentication, actual job delivery, reconnect and close are real. This is
not a PostgreSQL permission test, real log-analysis business acceptance, a
production startup approval, or a complete upgrade/recovery rehearsal.

The parent coordinator owns permanent test configuration and mandatory CI routing.
Until that integration is present, the isolated suite's local execution is
component evidence only; ordinary backend collection skips it unless explicitly
enabled. Production commands are not supplied by this component. Never point this
fixture at an existing Redis deployment or reuse its test credentials.
