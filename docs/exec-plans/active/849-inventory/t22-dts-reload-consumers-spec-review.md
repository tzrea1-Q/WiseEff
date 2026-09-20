# T2.2-DTS design Spec review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-dts-reload-consumers-spec-review.md)

Model: grok-4.6 (requested gpt-5.6-luna unavailable)
Verdict: **PASS with P2**

Independent Spec review of [t22-dts-reload-consumers-design.md](t22-dts-reload-consumers-design.md) and [t22-dts-reload-consumers-threat-matrix.md](t22-dts-reload-consumers-threat-matrix.md). Reviewer did not write the design. No production edits, commit, or T2.2-DTS completion in the review itself.

Review `01a0b01e-21b9-79e1-a8cf-75485959fd8e` **PASS with P2**. P2s folded into the design/matrix before production edits.

## P1

None open. Intercept is not the pin. Overlay stays DTS. Promote stays drafts. Edits not pre-authorized. Leftover intercept after repair is Spec fail even if delta ≠ 0.

## P2 (folded before implementation)

1. Family gate is source-SQL pin + binding-only verify + delete intercept + existing unit tests. HANDOFF/PROMOTE Playwright stay planned (T3.2 owns unskip). `skip(true)` is not proof of those cases.
2. Inner join `dts_property_specs` is **required**, not optional.
3. Comparison tests must also forbid `specification_key` in `display_name` / `order by`.
4. ZH: residue/restore keep; inventory link; `server/modules/dts-reload/**`; handoff/promote e2e may be classified.

**Implementation may start** (P2s folded). Do not start T2.2-KNW. Do not mark T2.2-DTS complete from this review.
