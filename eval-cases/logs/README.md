# Log analysis golden case set

> Chinese: [`README.zh-CN.md`](README.zh-CN.md)

The golden case set (glossary: *Golden case set*, `CONTEXT.md`) is the labelled corpus that anchors the log-analysis **quality-layer eval** (`npm run logs:eval:quality`). One shared set serves regression gating, model/prompt comparison, and (from P3) online monitoring.

## Layout

```
eval-cases/logs/
  README.md                      # this guide (EN) + README.zh-CN.md (zh)
  baseline.json                  # committed quality baseline (see "Baseline gate")
  <domain>/                      # log-domain slug, e.g. charging-power, uncategorized
    <case-id>/                   # kebab-case, stable, descriptive
      log.txt                    # the log content exactly as it would be uploaded
      case.yaml                  # the annotation (schema below)
```

## `case.yaml` schema

Validated by `server/modules/logs/eval/goldenCases.ts` (zod). A broken case fails the quality-eval run with a per-case problem list.

| Field | Required | Meaning |
| --- | --- | --- |
| `domain` | yes | Log-domain slug; must equal the parent directory name |
| `summary` | yes | One-line human description of the scenario |
| `realLog` | yes | `true` = de-identified real log (counts toward quality scores and the baseline gate); `false` = synthetic (format coverage only) |
| `deIdentified` | when `realLog: true` | De-identification attestation; a real case without `deIdentified: true` fails validation |
| `rootCauseCategory` | yes | Eval-only enum (below) — never part of the product output contract |
| `rootCausePoints` | non-refusal cases | Expert-confirmed root-cause statements the conclusion must cover |
| `keyEvidenceLines` | non-refusal cases | 1-based raw line numbers of the decisive evidence (must exist and be non-blank) |
| `expectedActions` | non-refusal cases | Actions an expert would expect the report to suggest |
| `expectRefusal` | no (default `false`) | `true` = the honest outcome is a refusal / low-confidence answer, not a diagnosis |
| `analysisQuestion` | no | Optional user question; the conclusion must address it |
| `formatProfile` | no | Optional declarative format profile applied when parsing `log.txt` (format-coverage cases) |

### `rootCauseCategory` values (v1)

`thermal-protection`, `communication-failure`, `device-unavailable`, `power-delivery-degradation`, `configuration-error`, `hardware-fault`, `software-fault`, `no-fault`, `insufficient-evidence`.

The enum exists purely for scoring (root-cause bucket match); extend it deliberately when a new domain onboards, and never leak it into the product contract.

## Annotation-draft export from `/log-admin` (P3)

To promote a live analyzed case into an annotation without hand-copying fields, open the record's drawer in `/log-admin` and use **导出评测案例草稿**. It downloads two files ready for this layout: a `case.yaml` draft (domain slug suggested from the record's log domain or `uncategorized`, `realLog: true`, **`deIdentified: false`**, `rootCauseCategory: TODO`, `keyEvidenceLines` prefilled from the report's evidence anchors, `rootCausePoints` split from the conclusion, `expectedActions` from the suggested actions, `analysisQuestion` carried over) plus `log.txt` (the raw lines exactly as analyzed, line numbers stable).

The export is deliberately a DRAFT with no repository write or auto-commit. Before the case may enter git you must still: (1) de-identify `log.txt` and the yaml against the checklist below, (2) replace the `rootCauseCategory` TODO with a real enum value, (3) have the owning domain expert confirm the prefilled points/lines/actions, and (4) flip `deIdentified` to `true`. The loader rejects drafts that skip any of this — an unfinished export can never silently count as a golden case.

## Annotation guide

1. **Source**: prefer real production logs confirmed by the owning domain expert. Target 20–50 annotated real cases per domain before the domain's quality gate activates.
2. **Root cause**: write `rootCausePoints` as short factual statements an expert signed off, not paraphrases of log lines.
3. **Evidence lines**: cite the *decisive* lines only (usually 1–5). Line numbers are 1-based over the raw file, exactly as the product's evidence anchors work.
4. **Actions**: list what a competent engineer should do next; these feed the rubric judge, not string equality.
5. **Refusal cases**: when the log genuinely does not support a diagnosis, set `expectRefusal: true` and leave the root-cause fields empty — honest refusal is a scored behavior.
6. **Synthetic cases**: mark `realLog: false`. They exist to cover format pictures (timestamp shapes, severity vocabularies, JSON lines, kernel style…) and never count toward quality scores.

## De-identification checklist (required for `realLog: true`)

Before a real log enters git, ALL of the following must hold — cases that cannot be fully de-identified stay out of the repository set:

- [ ] No personal names, phone numbers, emails, or account identifiers
- [ ] No customer/company names, project code names, or contract identifiers
- [ ] No device serial numbers, MACs, IMEIs, or precise geolocation
- [ ] No IP addresses/hostnames that identify a customer network (replace with `host-anon-N`)
- [ ] No credentials, tokens, or internal URLs
- [ ] Replacements keep line numbers and technical semantics stable (same line count, same codes)
- [ ] The owning domain expert confirmed the annotation after de-identification
- [ ] `deIdentified: true` is set in `case.yaml`

## Baseline gate

`eval-cases/logs/baseline.json` stores the last accepted quality scores. When present, `npm run logs:eval:quality` compares the current run against it: **`realLog: true` cases must not score below the baseline minus the stated tolerance** (tolerances are declared in the report). While the set contains no real cases, the report states `quality baseline pending real cases` and the gate stays inactive — the mechanism itself is exercised by tests.

## Human review records (`reviews/`, P3b judge calibration)

Each quality run deterministically samples judged cases into the checklist `docs/generated/log-analysis-judge-sample.md` (rate `LOG_ANALYSIS_JUDGE_SAMPLE_RATE`, default 0.2, minimum 1). A human reviewer scores the sampled cases on the same 0..1 rubric and commits the checklist's template as `eval-cases/logs/reviews/<run-id>.yaml`:

```yaml
runId: qe-20260813-020107
reviewer: expert-name
reviewedAt: 2026-08-13
cases:
  - id: charging-power/case-dir
    humanRootCauseScore: 0.75 # 0..1, same scale as the judge
    humanCategoryMatch: true # optional
    notes: "matches the annotation except the secondary cause" # optional
```

The next `logs:eval:quality` run loads every file under `reviews/`, validates the schema (broken files fail the run), matches reviews to the current run's judged cases **by case id**, and reports judge-human agreement (exact agreement rate + mean absolute difference + category agreement) in the fixed "Judge calibration" report section. No reviews committed yet → the report honestly says "no human reviews yet". Do not fabricate reviews for synthetic cases to make the metric look alive.

## Current status

All committed cases are `realLog: false` format-coverage seeds. Real expert-annotated cases (20–50 per domain, second pilot domain named by the product owner) are an open external dependency tracked in the P2 plan — never fabricate "real" cases. No human review records exist yet for the same reason: judge calibration against synthetic-only cases would calibrate on noise.
