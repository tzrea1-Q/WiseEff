# Signals during initialization

[中文](processSignals.README.zh-CN.md)

`server/index.ts` and the executable `workerRunner.ts` install SIGINT/SIGTERM
ownership before their first asynchronous database or queue initialization.
Repeated signals share one shutdown promise. A signal requests cancellation;
the owner waits for the current initialization to settle before draining its
published resources. Checks after asynchronous allocations prevent later
listener/consumer construction. An already initializing queue retains its
existing factory and draining semantics; this does not introduce cancellation
inside BullMQ or change queue admission.

The API uses its existing request/worker/pool drain, including when its listener
has not yet been constructed. The worker closes an admitted runtime on an early
stop before listening or starting consumers. Original admission failures remain
failures; root diagnostics remain static. No Catalog projection, permission,
runtime purpose, or report approval is changed.

The two `processSignals.test.ts` subprocess cases exercise actual OS signals,
IPC, and a TCP listener. Their database resource and active operation are
explicit test seams. The late callback must settle before the simulated pool
closes; merely observing a terminated process is not success. The initial
late-installation baseline failed one of two cases; the early owner passed both.
This baseline reproduces the prior ordering and is not an execution of the old
production roots. `workerRunnerBootstrap.test.ts` separately verifies the real
root function's early-stop cleanup with its existing admitted-database seam.

The additional owned Redis case runs the actual queue runtime and BullMQ task
in a subprocess, delivers SIGTERM then SIGINT while processing is held, and
requires a single graceful drain before closing its explicit database seam.
It consumes the supervising runner's existing private Redis receipt; no child
creates Docker resources. Exact code `ac3423680ac6d348a18a80707fe48508ad34286b`
ran the owned `log-redis` suite: 12 collected, 12 passed, no failed/skipped,
exit 0, 5.09 seconds, cleanup verified. The new signal case took 2.365 seconds.
The image was Linux/arm64 `redis:7-alpine`,
`sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf`.
Log `/tmp/upg824-initialization-signals-ac342-redis.log` has SHA-256
`7e0462a877d39406404067fcf14ec22aadc1387a47f5d5fade54cac7bcadfcc6`.
This subsequent documentation commit does not change that execution identity.
None of these tests proves real PostgreSQL business effects or an approved
production API/worker startup.

Focused commands use the existing runtime bootstrap selector for caller tests
and `tsc --noEmit -p tsconfig.node.json`. The parent owns registration of the new
pure selector in `vitest.runtime-bootstrap.config.ts`; before that registration,
the development-only pure config explicitly selected `server/processSignals.test.ts`.
The existing `log-redis` owned suite collects the added Redis case without a new
resource profile or longer timeout.
