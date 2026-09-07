# Owned retirement endpoint tests

> Chinese: [中文](retirement-endpoint-supervision.README.zh-CN.md)

The developer component runner owns the endpoint fixture. It is not a production
retirement, restore, approval, or upgrade entry. Its control flow reuses the
existing local-daemon guard and Hosted admission. No deployment URL is accepted.

On an independently approved development Docker Desktop host, from a fixed clean
candidate with locked dependencies and the local `postgres:16-alpine` image:

```bash
: "${UPG_EXPECTED_DAEMON_ID:?approved development daemon identity required}"
env -i PATH="$PATH" HOME="$HOME" node --import tsx \
  scripts/run-upgrade-component-tests.ts \
  --expected-daemon-id "$UPG_EXPECTED_DAEMON_ID" --suite retirement-existing-pg16
```

The parent creates its normal isolated component cluster and an additional
nonce network with two PostgreSQL containers and two endpoint probes. All endpoint
containers use the observed image ID; database credentials are random and only
passed to tests in the private 0600 receipt. The probes have distinct aliases; one
deliberately has hostname `postgres` to test resolver ambiguity. This fixture uses
tmpfs PostgreSQL storage and no production volumes. It is not a backup rehearsal.

Before any endpoint creation, the parent fsyncs the complete resource names,
ownership nonce and image into a private plan. Returned IDs are separately
appended and fsynced. Lost create acknowledgments are resolved only by the
predeclared exact name, nonce and image. A foreign or changed object is not deleted;
cleanup failure makes the run fail and retains its private evidence directory.
The check before each readiness iteration also refuses an interrupted parent.

The same rule covers the main component profile's network, volume and service
container. All three have exact predeclared names and a private fsynced plan;
the service has an explicit Docker name even if `docker run` loses its response.
Cleanup reconciles an unknown acknowledgment against that exact name and the
run label (also the image for containers). It checks all three resources despite
another cleanup failure, refuses foreign ownership and retains private evidence
on any failure. It never treats the absence of a returned ID as proof that no
resource was created.
Returned resource identities are checked before any dependent creation, including
the ownership of a volume that Docker might return as an already existing name.
Network and volume identities are checked again before mounting the service.

The business file consumes the receipt and can start/stop owned probes or apply
bounded network-alias faults; it creates and removes no Docker resources. The
supervision file likewise consumes the receipt, kills a TERM-resistant process
group, and verifies that the parent still owns the topology. That case alone is
not evidence of parent cleanup after Vitest termination. A separate outer fault
experiment calls `runUpgradeComponentTests` with shorter in-process supervisor
limits, records its secret-free endpoint observation, and verifies every exact
container/network is absent after the parent returns failure. This injection has
no CLI option and cannot increase the standard 15-minute/8-MiB/2-second limits.

The exact two files are mandatory in `vitest.upgrade-retirement.config.ts`, with
missing receipt and empty collection rejected. Ordinary server/scripts suites
exclude these files; the existing mandatory Hosted component job owns them.
Missing component files cause refusal before resource creation. Existing role and
resolver assertions and their timeouts remain unchanged. A timeout is a failed
run even if all newly owned resources are successfully removed. SIGKILL or host
loss of the supervising parent itself is not an automatic-cleanup guarantee;
the durable private plan is retained for explicit inspection, not blind deletion.

Documentation impact: this paired file records only fixture ownership, mandatory
routing and supervision evidence. Product authorization, P13 semantics, migration
inventory, grants and deployment operations are unchanged. Complete controller,
approved P12/P13 and production startup evidence remain separate requirements.

The separate `--suite bootstrap-credential-pg16` route runs only
`bootstrapCredentialFence.integration.test.ts` in another fresh PG16 cluster.
It does not share the retirement endpoint cluster: changing OID 10 credentials
is a cluster-wide effect. Its exact config rejects missing ownership evidence
and empty collection and keeps the original default test/hook deadlines. The
ordinary server lane excludes it; the mandatory component job runs it separately.
Parent cleanup uses Docker identity, not the old database password. This route
does not authorize production credential rotation or establish completed P13.
