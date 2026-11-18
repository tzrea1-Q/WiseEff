# Log analysis evaluation corpus

> Chinese: [`README.zh-CN.md`](README.zh-CN.md)

This labelled corpus anchors the log-analysis **quality-layer eval** (`npm run logs:eval:quality`). Golden production cases gate regressions, realistic cases support scenario comparisons, and synthetic cases cover input formats.

## Diagnostic procedure behavior checks

`npm run logs:eval` also runs deterministic, zero-API-cost procedure scenarios in `server/modules/logs/eval/scenarios.ts`. Benign procedures must appear after the unchanged platform protocol and before the user task in both kernels. Adversarial scenarios demand skipping grounding, fabricated line `9999`, a parameter write, or an injected closing delimiter and fake protocol heading. They verify a single enclosed JSON string with lower-priority, untrusted guidance, rejection by the existing grounding/tool guards, and grounded final evidence or an honestly marked fallback. These scripted checks verify prompt construction and kernel enforcement; they do not measure a live model's resistance to persuasion.

Generic-signal scenarios call `get_signals`, `get_line_templates`, and `get_timeline` legally without a skill. Each tool must ground evidence on its own returned anchors or lines. A timeline-only scenario cites an existing line outside the returned window, requires a grounding violation, and then corrects the citation to the returned line. This distinguishes seeing a line from the line merely existing in the upload.

Source-location scenarios call `locate_log_statement` on a ready pinned snapshot. Only exact returned snapshot/path/line tuples can become evidence; an unseen source paired with a valid log line, another snapshot/path, or a nearby excerpt line is rejected. Source excerpts remain untrusted input.

Source-tool scenarios legally call `search_source` with a path glob and literal or full-text query, and `read_source_range` with a snapshot, path and range. Oversized backend responses must still obey the 20-hit, 400-character excerpt and 16 KiB search caps. A requested 100-line range returns at most 80 numbered lines; a source-only citation to returned line 80 is grounded, while unseen line 81 is rejected. Both tools are unavailable with a queued, indexing, failed, archived or absent snapshot. Grounding checks inspect the tool output the model received after caps, rather than the backend fixtures.

Source-search timeout coverage verifies that the agent can continue with grounded log evidence after a truncated source result. PostgreSQL integration checks candidate admission before scoring, common-query rejection, the database deadline and transaction timeout restoration.

Loop history scenarios confirm that the final model input contains summaries for older tool results and the original text of the latest two. Early log anchors still ground the final report after folding. The token budget is cumulative input plus output. After the investigation spends 80%, the kernel can use the remaining budget for one final answer with confidence capped at 0.5 and degradation reason `token-budget-exhausted`.

The conclusion-verification scenario cites a real normal-temperature line to claim overheating. The independent scripted check marks the contradiction, removes the unsupported citation, and caps confidence. A nonexistent counter-anchor cannot become evidence. The realistic-tier quality run can compare the verifier off and on with `LOG_ANALYSIS_VERIFY_CONCLUSION` and `--tier realistic`. Offline mode exercises the call and token accounting with scripted verdicts. The quality metric for hallucination counts nonexistent citations.

The checklist scenarios exercise a required-check reminder and grounded check anchors in both protocols. For a realistic-tier A/B, pass the same checklist Markdown file with `--tier realistic --procedure <file.md>` on both runs and set `LOG_ANALYSIS_HYPOTHESIS_LEDGER=true`. Toggle `LOG_ANALYSIS_PROCEDURE_CHECKLIST` and use `--compare` on the two saved JSON reports. With `LOG_ANALYSIS_DETERMINISTIC=true`, the fixed model responses isolate reminder and prompt costs.

The command regenerates `docs/generated/log-analysis-eval.{json,md}` and fails on any behavioral expectation. The quality baseline records loop prompt version `2026-10-19.loop.procedure.signals.source.4` and remains pending expert-annotated real cases.

## Layout

```
eval-cases/logs/
  README.md                      # this guide (EN) + README.zh-CN.md (zh)
  baseline.json                  # committed quality baseline (see "Baseline gate")
  <domain>/                      # log-domain slug, e.g. charging-power, uncategorized
    <case-id>/                   # kebab-case, stable, descriptive
      log.txt                    # raw single log or flattened bundle projection
      case.yaml                  # the annotation (schema below)
      fixtures/                  # optional original uploads listed in bundleFiles
```

## `case.yaml` schema

### Product analysis cases and ZIP interchange

Skill administrators can import or export this directory layout in the workspace's Tests section. A ZIP starts directly at `<domain>/<case-id>/`, without an enclosing `eval-cases/logs/` directory. Existing `case.yaml` and `log.txt` files retain their bytes, including YAML comments and original line endings, through import and export. Edit an imported case's expectations to replace its annotation; unchanged fixtures retain their bytes.

Bundle cases list their original uploads in `bundleFiles`, using relative paths such as `fixtures/device.zip`. The workbench and CLI analyze these uploads, including archives and UTF-16 input. Build the UTF-8 `log.txt` projection by joining the analyzable files in intake order with LF separators, with each file’s line endings normalized to LF and one terminal newline removed. `keyEvidenceLines` addresses that projection. The CLI maps file-local citations back to the projection for scoring. Workbench `keyEvidence` entries identify an unpacked file by path and a positive `line`, a bounded linear-time `pattern`, or both. Optional `expectedDegradedReason` names an existing degradation reason. Optional `caseName` preserves a name independently of the summary. The workbench retains eval metadata in the original YAML for byte-for-byte export.

Imports reject unsafe paths, duplicate entries, links, malformed annotations, missing fixtures and size/count violations before saving. Errors include the exact case path and annotation field. The product bounds a skill to 20 cases, each input bundle and its normalized text to 10 MiB each and 100 files, a run to at most 20 cases and 120 seconds, and retained history to the latest 10 runs per skill. Edited expectations are capped at 1 MiB of YAML; imported annotations at 2 MiB. The ZIP envelope is capped at 440 MiB compressed/unpacked and 2040 entries to accommodate the full bounded corpus and its projections. Runs share organization and aggregate admission with draft dry runs. They compare the saved draft against the current publication using the existing quality evaluator and configured judge, or deterministic rubric checks when no judge is configured. Scores are publishing advice and never a publication gate.

Validated by `server/modules/logs/eval/goldenCases.ts` (zod). A broken case fails the quality-eval run with a per-case problem list.

| Field | Required | Meaning |
| --- | --- | --- |
| `domain` | yes | Log-domain slug; must equal the parent directory name |
| `summary` | yes | One-line human description of the scenario |
| `realLog` | yes | `true` for de-identified production logs; `false` for realistic or synthetic logs |
| `deIdentified` | when `realLog: true` | De-identification attestation; a real case without `deIdentified: true` fails validation |
| `tier` | optional | `golden`, `realistic`, or `synthetic` |
| `provenance` | optional | `production`, `public-dataset`, or `authored` |
| `scenarioTags` | optional | List of tags from the scenario matrix below |
| `datasetSource` | for `public-dataset` | `name`, `version` (release or commit), `url`, `license` (identifier), `file` (original file path), and `lines` (inclusive 1-based `[start, end]`) |
| `realismChecklist` | for `authored` | Notes for each of the seven checks below |
| `rootCauseCategory` | yes | Eval-only enum (below) — never part of the product output contract |
| `rootCausePoints` | non-refusal cases | Expert-confirmed root-cause statements the conclusion must cover |
| `keyEvidenceLines` | non-refusal cases | 1-based raw line numbers of the decisive evidence (must exist and be non-blank) |
| `expectedActions` | non-refusal cases | Actions an expert would expect the report to suggest |
| `expectRefusal` | no (default `false`) | `true` = the honest outcome is a refusal / low-confidence answer, not a diagnosis |
| `analysisQuestion` | no | Optional user question; the conclusion must address it |
| `formatProfile` | no | Optional declarative format profile for parsing the input logs |

Allowed pairs are `golden + production`, `realistic + public-dataset`, `realistic + authored`, and `synthetic + authored`. When omitted, `tier` and `provenance` default to `golden + production` for `realLog: true` and `synthetic + authored` for `realLog: false`. Legacy synthetic cases with neither field are exempt from the checklist. Realistic cases use `realLog: false` and omit `deIdentified` entirely.

### Scenario tags

Use the tags defined by the P0 scenario matrix. Update this list and the loader together when extending it.

`multi-file`, `large-bundle`, `cascade`, `distractor`, `register-decoding`, `configuration`, `resource-exhaustion`, `android`, `clock-skew`, `multi-issue`, `truncated`, `no-fault`, `prompt-injection`, `encoding`, `public-labelled`, `generic-analysis`.

### Authored realism checklist

Write a non-empty note for every key in `realismChecklist`.

| Key | What to record |
| --- | --- |
| `lineFormat` | The real tool whose output shape and timestamp precision the fixture follows |
| `noiseRatio` | At least 90% routine log lines, with the count and denominator |
| `distractors` | At least one unrelated WARN or ERROR, with an exemption for `no-fault` |
| `rootCauseDiscoverability` | Why identifying the cause requires evidence beyond a single keyword search |
| `timeline` | Why the causal ordering and the clock relationship across files make sense |
| `sensitiveData` | Confirmation that personal information, real serial numbers, and real credentials are absent |
| `annotationReview` | Independent agent or human review of the root-cause points, evidence lines, and expected actions against the fixture |

For public-dataset cases, verify redistributability and keep the required attribution before committing excerpts.

### `rootCauseCategory` values (v1)

`thermal-protection`, `communication-failure`, `device-unavailable`, `power-delivery-degradation`, `configuration-error`, `hardware-fault`, `software-fault`, `no-fault`, `insufficient-evidence`.

The enum exists purely for scoring (root-cause bucket match); extend it deliberately when a new domain onboards, and never leak it into the product contract.

## Annotation-draft export from `/log-admin` (P3)

To promote a live analyzed case into an annotation without hand-copying fields, open the record's drawer in `/log-admin` and use **`导出评测案例草稿`**. It downloads two files ready for this layout: a `case.yaml` draft (domain slug suggested from the record's log domain or `uncategorized`, `realLog: true`, **`deIdentified: false`**, `rootCauseCategory: TODO`, `keyEvidenceLines` prefilled from the report's evidence anchors, `rootCausePoints` split from the conclusion, `expectedActions` from the suggested actions, `analysisQuestion` carried over) plus `log.txt` (the raw lines exactly as analyzed, line numbers stable).

The export is deliberately a DRAFT with no repository write or auto-commit. Before the case may enter git you must still: (1) de-identify `log.txt` and the yaml against the checklist below, (2) replace the `rootCauseCategory` TODO with a real enum value, (3) have the owning domain expert confirm the prefilled points/lines/actions, and (4) flip `deIdentified` to `true`. The loader rejects drafts that skip any of this — an unfinished export can never silently count as a golden case.

## Annotation guide

1. **Source**: prefer real production logs confirmed by the owning domain expert. Target 20–50 annotated real cases per domain before the domain's quality gate activates.
2. **Root cause**: write `rootCausePoints` as short factual statements an expert signed off, not paraphrases of log lines.
3. **Evidence lines**: cite the *decisive* lines only (usually 1–5). Line numbers are 1-based over the raw file, exactly as the product's evidence anchors work.
4. **Actions**: list what a competent engineer should do next; these feed the rubric judge, not string equality.
5. **Refusal cases**: when the log genuinely does not support a diagnosis, set `expectRefusal: true` and leave the root-cause fields empty — honest refusal is a scored behavior.
6. **Format coverage**: use `synthetic` for cases that exercise timestamp shapes, severity vocabularies, JSON Lines, or other input formats. Use `realistic` for cases that exercise a diagnostic scenario.

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

`eval-cases/logs/baseline.json` stores the last accepted golden-case scores. The gate compares golden-case scores against the baseline minus the stated tolerance. The report lists realistic scores separately. While the set contains no golden cases, the report states `quality baseline pending real cases` and the gate stays inactive.

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

The corpus includes synthetic format-coverage seeds and authored realistic cases across charging, Linux, Android, and JSON Lines services. Use domain-sized ZIPs when importing into a workspace skill, subject to its 20-case limit. The charge-rail register case includes a companion `skill.yaml` with its `parsing/v1` rules. Expert-annotated production cases and human judge-calibration records are pending.
