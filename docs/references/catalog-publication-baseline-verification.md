# Catalog publication baseline verification

> Chinese: [中文](../zh-CN/references/catalog-publication-baseline-verification.md)

Status: **CP-01 read-only record**. Not Artifact adoption, not Catalog mutation, not production authorization.

This file is owned by CP-01. It must not be used as a second copy of the CP-00 contract. Contract: [ADR-0043](../adr/0043-catalog-authoring-and-online-publication.md), [control plane](../design-docs/catalog-authoring-and-publication-control-plane.md), [active plan](../exec-plans/active/2026-09-12-catalog-authoring-publication.md).

## 1. SHAs

| Item | Value | How obtained |
| --- | --- | --- |
| Plan-brief main | `c332ed3cc2893cadc10d50e235f291bb8fd1ac30` | Architecture brief; **stale** |
| `origin/main` at this record | `063b12c49dbc134e83103c77b813188e34f09461` | `git fetch origin main` in this session |
| Delta | [#826](https://github.com/tzrea1-Q/WiseEff/pull/826) vendor successor compiler + `advance` CLI | `git log c332ed3cc..063b12c49` |
| This Scratch branch | `docs/catalog-authoring-publication-cp00` | worktree `/private/tmp/wiseeff-catalog-authoring-publication` |
| User workspace at session start | `docs/catalog-repair-status` @ `475695fb9` | unrelated; not this candidate |

#826 path delta vs the brief SHA (documentation/scripts/tests only):

- `scripts/compile-vendor-catalog-release.ts` and tests
- `scripts/install-catalog-release.ts` (`--mode bootstrap|advance`, expected current pin, confirm digest)
- `server/modules/catalog-kernel/install/vendorSuccessor.integration.test.ts`
- `ops/self-hosted/upgrade.md` (+ zh), `operations.md` (+ zh)
- verification-matrix / self-hosted runtime docs (from the #826 landing)

No ADR or design-doc change landed in #826. That gap is why CP-00 exists.

## 2. Verified vs unverified

### Verified from the repository at `063b12c49`

| ID | Fact | Notes |
| --- | --- | --- |
| R-F1 | Highest migration prefix in tree is `0139_parameter_catalog_verification_core.sql` | Next number is confirmed at CP-02 merge, not reserved here |
| R-F2 | `installPublishedRelease` supports bootstrap and advance with `expectedCurrent`, exclusive lock, kernel-owned transaction | Code on main; this lane did not re-run PostgreSQL |
| R-F3 | First fixture release id `crel_acme_1`, digest `sha256:365305492cf3fddb973b65268d1c7b8c60715240e9fd2dac05aa9091f0c38044` | `validCatalogReleaseBundle()` first release; compiler constants `FIRST_ACME_*` |
| R-F4 | Vendor successor compiler constants: id `crel_vendor_catalog_1`, version `1.1.0`, publishedAt `2026-09-12T00:00:00Z`, digest `sha256:efc5336e625f0eb6f994223a5f67a57b119e92bda2edb5c209fc901284f126c7` | Repository compiler output when tests pass; **not** a host install |
| R-F5 | Compiler test counts for that successor: 48 subjects, 1 alias, 114 definitions/revisions | Includes predecessor `csub_acme_power` / `pdef_acme_power_iin_max`; excludes `shared_prop`, `fast_charge_current_limit_ma`, `status`, ambiguous ids |
| R-F6 | `schemas/dts/catalog.json` lists **49** `schemaPaths`; `vendorContentHash` `fd4051a43b5d62f050eabd3a57c26e583498c5dda95f1a9c3c701670399042f0`; `importedAt` `2026-07-16T00:00:00.000Z` | Exact list, not the brief’s “about 50” |
| R-F7 | `schemas/dts/vendor/wiseeff/` contains **50** YAML files | `common-status.yaml` is on disk and **not** in `schemaPaths` |
| R-F8 | Compiler excludes `common-status.yaml`, `test-ambiguous-a.yaml`, `test-ambiguous-b.yaml` | The two test files **are** listed in `schemaPaths`; `common-status.yaml` is not |
| R-F9 | All 49 listed files parse with `lifecycle: active` | Belt-and-suspenders skip of non-active is unused on this inventory |
| R-F10 | Naive `properties:` walk of listed files after excluding the two test YAMLs: 135 nested property entries, 113 non-structural | **Not** the compiler’s 114 definitions. Do not treat 130 as a verified definition count |
| R-F11 | Original first-release bundle exists as `server/modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle.ts` | This is the repository source of `crel_acme_1`. It is **not** proof the host still has those exact bytes |
| R-F12 | Accept Proposal still requires `repositoryReference` | `server/modules/parameter-governance/proposals/command.ts` |
| R-F13 | `readApprovedRuntimePin` still requires exact P13 / writer-retirement fingerprint / pin match | Unchanged by #826 |
| R-F14 | `parameter-data-mode` new-empty path is read-only toward an installed Catalog | Unchanged by #826 |

### User-reported, **not** host-verified

| ID | Report | Use |
| --- | --- | --- |
| H-R1 | Host upgraded `new-empty` and bootstrapped `crel_acme_1` | To verify with the collector after authorization |
| H-R2 | Host digest `sha256:365305492cf3fddb973b65268d1c7b8c60715240e9fd2dac05aa9091f0c38044` | Same |
| H-R3 | Host current definitions = `acme,power` / `iin_max` only | Same |
| H-R4 | Vendor successor has **not** been advanced on the host | Consistent with “no second bootstrap / no seed / no Catalog SQL” instruction; still unverified |

### Not accessed / not run

| Item | Status | Owner |
| --- | --- | --- |
| Target-host PostgreSQL | **Not accessed.** No DSN was provided. This lane did not scan the network or log in. | Human operator |
| Deploy data mode on the host | Unverified | Collector |
| Host migration ledger and checksums | Unverified | Collector |
| Host current id/digest/heads | Unverified | Collector |
| Host subject/definition/binding/value counts | Unverified | Collector |
| Host referenced historical releases | Unverified | Collector |
| Exact installed bundle bytes on the host | Unverified | Collector + Artifact store |
| Independent projection verification on the host | Unverified | Collector / verifier role |
| Recompile-from-host-bytes equals current pin | Unverified | Blocker for adoption if it fails |
| Real PostgreSQL tests this wave | **Not run** | — |
| Browser / Hosted / production | **Not run** / **not granted** | — |

**Blocker:** online publication adoption of the current instance is **blocked** until the host evidence below is collected. Existing reads may continue. CP-00 may continue. Do not disguise the missing host bundle as complete.

## 3. Repository vendor inventory (not a host Catalog)

Do not encode “~50 YAML / ~130 properties” as an acceptance assertion.

| Set | Count | Disposition |
| --- | --- | --- |
| `schemaPaths` | 49 | Authoritative vendor list |
| On-disk `vendor/wiseeff/*.yaml` | 50 | Extra: `common-status.yaml` (retired/excluded, not listed) |
| Listed minus compiler exclude | 47 | Input to #826 successor compiler |
| Compiler successor definitions | 114 | Includes `crel_acme_1` predecessor content; **repository test**, not host |
| Naive property-entry walk | 135 / 113 non-structural | Diagnostic only; silent drop of unconvertible fields is forbidden in CP-09 |

Structural keys that the vendor compiler may skip are constructor failures such as `compatible` / `reg` / `#address-cells` / `status`. Those skips are not omitted Parameters. CP-09 must still list every unconverted field with block-or-explicit-approve; it must not silently drop them.

`src/config/power-management.json` demo items remain **out of** the vendor definition set (locked before #826).

## 4. Minimum evidence the host must supply

Operator-authorized, read-only, redacted. No secrets in logs.

1. Application SHA actually running (image/source pin).
2. Catalog data mode (`new-empty` vs populated vs other).
3. Migration names + checksums.
4. `catalog_state.current_catalog_release_id` and `catalog_releases.release_digest`.
5. Counts: subjects, release memberships, aliases, definitions, heads, bindings, project values, referenced historical release ids.
6. Whether Artifact bytes for that digest exist outside the database (repository fixture, compiled YAML, or stored bundle).
7. Independent projection fingerprint vs compiled fixture for that digest.
8. Confirmation that `crel_vendor_catalog_1` is **not** current unless a separate advance was authorized.

If (6) or (7) fail: **do not adopt**. Keep reads. Do not rebuild a Release from projection rows. Do not substitute `validCatalogReleaseBundle()` for host bytes without a digest match.

## 5. Read-only collector design (not implemented this wave)

Proposed path: `scripts/inspect-catalog-publication-baseline.ts` plus tests. Implementation is a later small task with the guarantees below. This wave does not add that script.

### Guarantees

- DSN only from an explicit env `CATALOG_BASELINE_READONLY_DATABASE_URL` supplied by the operator. No default, no discovery, no compose-network scan.
- Connect as a dedicated role `catalog_baseline_reader` with `SELECT` on named Catalog and count relations only. The script `SET default_transaction_read_only = on` and `SET TRANSACTION READ ONLY` at `REPEATABLE READ`.
- Fail closed if the role has INSERT/UPDATE/DELETE/TRUNCATE on `parameter_catalog.*` or `catalog_publication.*`.
- Never compile a Release from table rows. Never INSERT Artifact rows. Never bootstrap/seed/advance.
- Never print the DSN, passwords, or PII. Counts and ids/digests only.
- Output a JSON document plus SHA-256 of the canonical JSON. That file is evidence, not an Artifact.

### Suggested queries (read-only)

```sql
SELECT current_catalog_release_id FROM parameter_catalog.catalog_state;
SELECT id, release_version, release_digest, predecessor_release_id
  FROM parameter_catalog.catalog_releases;
SELECT count(*) FROM parameter_catalog.catalog_subjects;
SELECT count(*) FROM parameter_catalog.catalog_release_subjects;
SELECT count(*) FROM parameter_catalog.parameter_definitions;
SELECT count(*) FROM parameter_catalog.definition_revisions;
SELECT count(*) FROM parameter_catalog.project_parameter_bindings;
-- plus organization registrations / project values as granted
```

Exact physical names follow generated schema at run time. Missing relations fail closed.

### Local compile check (no host)

After the operator copies **host-exported Artifact bytes** (not projection dumps) into an isolated directory, a second command may run `compileCatalogRelease` and compare digest to the exported current pin. Using the repo fixture is allowed only when its digest equals the host pin.

## 6. Adoption gate (not this wave)

`adopted-preexisting` may be written only when:

- host current id/digest match the compiled Artifact;
- independent projection check passes;
- Binding/ProjectValue counts are recorded before/after and unchanged;
- the proof is labeled `adopted-preexisting` and names collection time + approver;
- the entry cannot be reused as a general unsigned-bundle activator.

Until then: **online publication must not be enabled** on that instance.

## 7. Checks run / not run

| Check | Result |
| --- | --- |
| `git fetch origin main` | `063b12c49` |
| `git log c332ed3cc..063b12c49` | #826 only |
| Read `catalog.json` / vendor directory / compiler constants / installer / proposal accept / runtime pin docs | as above |
| Naive YAML property walk via `yaml` parse | 135 / 113 |
| `npm test` / `npm run test:server` / real PG / browser / Hosted / host SQL | **Not run** |
| Host login | **Not done** |
