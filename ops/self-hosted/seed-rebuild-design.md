# Reviewed example-parameter rebuild operator

> Chinese: [Chinese](seed-rebuild-design.zh-CN.md)

Status: implementation in progress, not target acceptance. Scope is the user-authorized archive and reviewed DTS/JSON rebuild of Atlas, Aurora and Nebula. Preserve other projects, users, roles, device nodes and non-parameter objects. No new schema, policy bypass, legacy installer fallback or activation of the unavailable P11–P16 program phases.

The deployed instance has an adopted `crel_acme_1` Catalog, populated old semantic bindings, and zero canonical bindings. Application upgrades deliberately do not seed. The operator composes existing publication, archive, source/materialization and disposal owners; it does not write Catalog heads or bindings directly.

## Interfaces and ownership

- `scripts/seed-rebuild.ts`: explicit plan/status, Catalog preparation/publication, rebuild and verification commands. Plans bind database identity, organization, exact code/source digests, three project identities, current Catalog and original inventory. Use real persisted user authorization; no synthetic actor, test capability, default grant or password rotation.
- `scripts/lib/seedCatalogPublication.ts`: reviewed vendor successor followed by ConfigurationSchema successor. Native candidate authorization and manager queue own publication. Immutable candidate/digest confirmation and independent reviewer policy remain enforced. Status observes actual activation receipts.
- `ops/self-hosted/scripts/seed-rebuild.sh`: existing Compose and upgrade storage/lock owners provide observed maintenance, fresh verified whole-state recovery, controlled manager-only publication, completion and recovery. Writers remain stopped on partial failure. Original service/queue/freeze state is retained.
- Rebuild calls existing archive/materialization/disposal owners. Each stage is durably recorded before writes. A possibly partial non-idempotent stage requires whole-state recovery rather than blind retry. Successful completed runs are verified before being reported as no-op.
- A private run directory contains secret-free plans/journal and references to separately protected storage backups. Never print DSNs, credentials, raw source contents or archive object references in ordinary status.

## Threat and acceptance matrix

| Case | Required observation / owner |
| --- | --- |
| Read-only plan | No DB/object write, no user/role grant; scoped inventory and explicit blockers. Focused CLI/PG tests. |
| Wrong user, organization or project/code | Refuse before publication/archive/source mutation. Real DB authorization tests. |
| Stale DB/code/source/Catalog/plan digest | Refuse before dependent writes. Pure plan tests and real PG drift test. |
| Same-author high-risk review / missing capabilities | Existing publication policy refuses; no bypass flag or auto-grant. Publication tests. |
| Candidate retry / queued manager / wrong receipt | Reuse exact frozen identity or refuse mismatch; do not seed until the intended Catalog receipt is observed. Publication tests. |
| Active writers, queue not drained, freeze failure, lock contention | No backup-success claim or rebuild; retain stopped state if entry was partial. Wrapper tests and owned-stack rehearsal. |
| Missing/tampered/wrong-instance backup | No rebuild or restore; existing storage identity and checksum verification retained. Wrapper tests and owned-stack rehearsal. |
| Truncated archive / unavailable object / mismatch | Stop before residue removal; exact archive verification through existing owner. Real object-store/PG test. |
| Adopted populated success | Reviewed Catalog published through manager; archive retained; exact reviewed DTS/JSON identity set materialized; other projects and non-parameter fingerprints unchanged. Integration rehearsal. |
| Interruption before/after durable stage | Either exact idempotent resume or explicit recovery-required; no duplicate publication/source facts. Focused tests and recovery rehearsal. |
| Disposal after materialization | Only captured old residue removed, successor facts retained; no DROP or cross-project deletion. Existing owner plus integration test. |
| Completion / repeated invocation | Verify live bindings/source pins, archive and preservation before reopening traffic or reporting success. No-op is not inferred from a journal flag alone. |
| Target execution | Human-operated native amd64 server only after reviewed local candidate; copyable commands and result checks. No local test substitutes for target evidence. |

Independent implementation/spec review is required before final delivery. Existing sealed-program readiness remains separate; this seam does not mark #853 or S1/S2 complete.
