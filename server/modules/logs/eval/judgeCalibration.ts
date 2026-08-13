import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import type { QualityCaseResult } from "./qualityEval";

/**
 * Judge calibration (P3b, glossary: Judge-human agreement): mechanism-first
 * plumbing that (a) deterministically samples judged quality-eval cases into a
 * human review checklist and (b) scores judge-vs-human agreement once review
 * files exist under `eval-cases/logs/reviews/<run-id>.yaml`. With no reviews
 * committed yet the report honestly says "no human reviews yet" — the mechanism
 * runs end to end while the expert-annotated real cases remain pending.
 */

export const humanReviewCaseSchema = z.object({
  /** Golden-case id (`<domain>/<case-dir>`) the review refers to. */
  id: z.string().min(1),
  /** Human root-cause score on the same 0..1 rubric scale the judge uses. */
  humanRootCauseScore: z.number().min(0).max(1),
  /** Optional human verdict on the eval-only root-cause category match. */
  humanCategoryMatch: z.boolean().optional(),
  notes: z.string().max(2000).optional()
});

export const humanReviewFileSchema = z.object({
  /** Quality run id the sample came from (informational; matching is by case id). */
  runId: z.string().min(1),
  reviewer: z.string().min(1),
  reviewedAt: z.string().min(1),
  cases: z.array(humanReviewCaseSchema).min(1)
});

export type HumanReviewFile = z.infer<typeof humanReviewFileSchema>;

export type LoadHumanReviewsResult = {
  reviews: HumanReviewFile[];
  /** Validation problems; a non-empty list fails the quality run (broken reviews must not silently drop). */
  problems: string[];
};

export function defaultHumanReviewsRoot(goldenCasesRoot: string): string {
  return path.join(goldenCasesRoot, "reviews");
}

export function loadHumanReviews(reviewsDir: string): LoadHumanReviewsResult {
  const reviews: HumanReviewFile[] = [];
  const problems: string[] = [];

  if (!existsSync(reviewsDir)) {
    return { reviews, problems };
  }

  const files = readdirSync(reviewsDir)
    .filter((name) => (name.endsWith(".yaml") || name.endsWith(".yml")) && !name.startsWith("."))
    .sort();
  for (const file of files) {
    const filePath = path.join(reviewsDir, file);
    let parsedYaml: unknown;
    try {
      parsedYaml = parseYaml(readFileSync(filePath, "utf8"));
    } catch (error) {
      problems.push(`reviews/${file}: not valid YAML (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const parsed = humanReviewFileSchema.safeParse(parsedYaml);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push(`reviews/${file}: ${issue.path.join(".") || "(root)"} — ${issue.message}`);
      }
      continue;
    }
    reviews.push(parsed.data);
  }

  return { reviews, problems };
}

/** FNV-1a 32-bit hash — stable across runs and platforms for deterministic sampling. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Uniform-ish [0, 1) selector derived from the case id only. */
export function judgeSampleSelector(caseId: string): number {
  return fnv1a(caseId) / 0x1_0000_0000;
}

/**
 * Deterministic review sample: a case is selected when hash(id) < rate, so the
 * same case set + rate always yields the same checklist (no run-to-run churn).
 * Only judged (non-refusal) cases are sampled; when the rate selects none, the
 * lowest-hash judged case is taken so every run produces at least one row.
 */
export function selectJudgeReviewSample(results: QualityCaseResult[], sampleRate: number): QualityCaseResult[] {
  const judged = results.filter((result) => result.judge !== null);
  if (judged.length === 0) {
    return [];
  }
  const rate = Math.min(Math.max(sampleRate, 0), 1);
  const sampled = judged.filter((result) => judgeSampleSelector(result.id) < rate);
  if (sampled.length === 0) {
    const fallback = [...judged].sort((left, right) => judgeSampleSelector(left.id) - judgeSampleSelector(right.id))[0];
    return [fallback];
  }
  return sampled.sort((left, right) => left.id.localeCompare(right.id));
}

export type JudgeHumanAgreement =
  | { status: "no-human-reviews-yet" }
  | {
      status: "computed";
      reviewers: string[];
      /** Review entries whose case id matched a judged case in THIS run. */
      matchedCaseCount: number;
      /** Review entries that referenced unknown/unjudged case ids (reported, not fatal). */
      unmatchedCaseIds: string[];
      /** Fraction of matched cases where judge and human scores are identical. */
      exactAgreementRate: number | null;
      /** Mean |judgeScore − humanScore| over matched cases. */
      meanAbsoluteDifference: number | null;
      /** Agreement on categoryMatch where the human recorded one; null when never recorded. */
      categoryAgreementRate: number | null;
      perCase: Array<{
        id: string;
        judgeScore: number;
        humanScore: number;
        absoluteDifference: number;
        reviewer: string;
      }>;
    };

/**
 * Judge-human agreement over the CURRENT run's judged cases: exact agreement
 * rate (identical scores) plus mean absolute difference, which carries graded
 * disagreement even when exact matches are rare.
 */
export function computeJudgeHumanAgreement(
  results: QualityCaseResult[],
  reviews: HumanReviewFile[]
): JudgeHumanAgreement {
  if (reviews.length === 0) {
    return { status: "no-human-reviews-yet" };
  }

  const judgedById = new Map(results.filter((result) => result.judge !== null).map((result) => [result.id, result]));
  const perCase: Array<{ id: string; judgeScore: number; humanScore: number; absoluteDifference: number; reviewer: string }> = [];
  const unmatchedCaseIds: string[] = [];
  const categoryPairs: Array<{ judge: boolean; human: boolean }> = [];

  for (const review of reviews) {
    for (const reviewedCase of review.cases) {
      const judged = judgedById.get(reviewedCase.id);
      if (!judged || !judged.judge) {
        unmatchedCaseIds.push(reviewedCase.id);
        continue;
      }
      perCase.push({
        id: reviewedCase.id,
        judgeScore: judged.judge.rootCauseScore,
        humanScore: reviewedCase.humanRootCauseScore,
        absoluteDifference: Math.abs(judged.judge.rootCauseScore - reviewedCase.humanRootCauseScore),
        reviewer: review.reviewer
      });
      if (reviewedCase.humanCategoryMatch !== undefined) {
        categoryPairs.push({ judge: judged.judge.categoryMatch, human: reviewedCase.humanCategoryMatch });
      }
    }
  }

  const exactMatches = perCase.filter((entry) => entry.absoluteDifference < 1e-9).length;
  return {
    status: "computed",
    reviewers: [...new Set(reviews.map((review) => review.reviewer))].sort(),
    matchedCaseCount: perCase.length,
    unmatchedCaseIds: [...new Set(unmatchedCaseIds)].sort(),
    exactAgreementRate: perCase.length === 0 ? null : exactMatches / perCase.length,
    meanAbsoluteDifference:
      perCase.length === 0 ? null : perCase.reduce((total, entry) => total + entry.absoluteDifference, 0) / perCase.length,
    categoryAgreementRate:
      categoryPairs.length === 0
        ? null
        : categoryPairs.filter((pair) => pair.judge === pair.human).length / categoryPairs.length,
    perCase: perCase.sort((left, right) => left.id.localeCompare(right.id))
  };
}

function truncate(text: string, maxChars: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 1)}…` : trimmed;
}

/**
 * Human review checklist written to `docs/generated/log-analysis-judge-sample.md`:
 * the sampled cases with the agent conclusion and the judge's verdict, plus a
 * ready-to-fill review file template for `eval-cases/logs/reviews/<run-id>.yaml`.
 */
export function formatJudgeSampleMarkdown(input: {
  runId: string;
  judgeLabel: string;
  sampleRate: number;
  sampled: QualityCaseResult[];
  totalJudgedCases: number;
}): string {
  const lines = [
    "# Log Analysis Judge Review Sample",
    "",
    `- Run id: \`${input.runId}\``,
    `- Judge: \`${input.judgeLabel}\``,
    `- Sampling: deterministic by case-id hash, rate ${input.sampleRate} (minimum 1) — ${input.sampled.length} of ${input.totalJudgedCases} judged case(s) selected`,
    `- Review record convention: commit the completed template below as \`eval-cases/logs/reviews/${input.runId}.yaml\`; the next quality run then reports judge-human agreement.`,
    ""
  ];

  if (input.sampled.length === 0) {
    lines.push("No judged cases were available to sample (all cases expect refusal or failed to run).", "");
    return lines.join("\n");
  }

  lines.push(
    "## Sampled cases",
    "",
    "| Case | Agent conclusion (truncated) | Judge root-cause score | Category | Actions score | Judge reasoning |",
    "| --- | --- | --- | --- | --- | --- |"
  );
  for (const result of input.sampled) {
    lines.push(
      `| ${result.id} | ${truncate(result.conclusionSummary, 120)} | ${result.judge!.rootCauseScore.toFixed(2)} | ${result.judge!.categoryMatch ? "match" : "miss"} | ${result.judge!.actionsScore.toFixed(2)} | ${truncate(result.judge!.reasoning, 160)} |`
    );
  }

  lines.push(
    "",
    "## Review template",
    "",
    "Score each case on the same 0..1 rubric the judge uses (root-cause coverage of the",
    "expert annotation). `humanCategoryMatch` and `notes` are optional but valuable.",
    "",
    "```yaml",
    `runId: ${input.runId}`,
    "reviewer: <your-name>",
    `reviewedAt: <YYYY-MM-DD>`,
    "cases:"
  );
  for (const result of input.sampled) {
    lines.push(
      `  - id: ${result.id}`,
      `    humanRootCauseScore: # 0..1 (judge said ${result.judge!.rootCauseScore.toFixed(2)})`,
      `    humanCategoryMatch: # true/false (judge said ${result.judge!.categoryMatch})`,
      "    notes: \"\""
    );
  }
  lines.push("```", "");
  return lines.join("\n");
}
