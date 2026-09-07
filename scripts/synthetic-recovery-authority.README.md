# Synthetic recovery authority

[Chinese](synthetic-recovery-authority.README.zh-CN.md)

`openSyntheticRecoveryAuthority` composes the existing production authentication,
deployment assignment, incident confirmation and typed recovery approval modules
for `rehearse-upgrade-recovery.ts`. It is not a production operator entry point.
The caller creates and owns a separate PostgreSQL container and its data volume;
the helper verifies the independently approved daemon, exact image, run label,
network, published endpoint, exclusive volume consumers and empty cluster before
creating a new control-plane database. It never uses an ambient database URL.
This existing rehearsal encodes each PostgreSQL identity as its actual container
ID; both source and destination IDs must equal their captured/selected identities.
This encoding is not imposed on the separate Docker recovery adapter's digests.
The auth volume itself must carry the exact run label and retain its recorded
creation/mount identity; one owned consumer alone is insufficient. All network
consumers, including stopped containers, must be in the parent's explicit ID
inventory and have the actual run label. The parent creates and cleans this
labelled volume; anonymous or foreign volumes are rejected.

The four synthetic principals use actual password logins. The incident-owner's
actual session is authenticated by `openDeploymentAuthority` through a separate
restricted LOGIN with only the existing five auth table SELECT privileges and
`auth_sessions.last_used_at` UPDATE. Operator, platform owner and technical
verifier remain different principals. No report is fabricated or approved.

The private assignment is limited to the current source, target, captured
package and restore attempt. The capture must already exist as a committed typed
host-journal event from `recordControlledRecoveryCapture`; this helper never
creates a replacement capture or treats a checksum as execution permission.
`recordRecoveryExecutionApproval` performs the existing package, token, session,
directory, lock and journal checks and appends the authoritative approval.

The caller supplies source database facts observed inside its real capture
boundary before stopping the source. This helper never reconnects to that source.
It neither restores stores nor resumes queues. The result contains only the
scoped approval and an idempotent close operation. Close awaits all its own pools
and descriptors; it does not delete parent-owned resources or private assignment
evidence. Partial preparation is retained and must not be retried against the
same cluster to manufacture a clean result.

## Threat and evidence boundary

Pure regressions exercise the public helper's refusal before database/Docker
access for source/target reuse, forged locks and malformed scope. They do not
mock a successful authentication, confirmation or approval. The actual positive
chain requires the parent's isolated PostgreSQL/package rehearsal; no real run
is claimed by these pure checks. No full application recovery or release
readiness follows from this synthetic approval.

This Scratch started at local main `67d4a7732`, then fast-forwarded to the exact
parent dependency `70c1a3ad0`. Only this module, its test and these paired notes
are the new change; no migration, grant manifest or shared authority code changes.

The first seven-case run failed one new private-input-accessor regression (six
passed); the corrected helper passes seven pure cases. This is a real error
redaction Red/Green, not a successful PG authorization or restoration claim.
Review exposed a separate foreign-volume gap: seven passed and the eighth test
observed an unwanted DB connection. The fix checks volume ownership before any
connection; two further cases reject unregistered/foreign network consumers.
