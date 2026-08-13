import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { validateLogFormatProfile, type LogFormatProfile } from "../formatProfile";

/**
 * Golden case set v1 (glossary: Golden case set): the labelled corpus under
 * `eval-cases/logs/<domain>/<case-id>/` (`log.txt` + `case.yaml`) that anchors the
 * quality-layer eval. Only `realLog: true` cases count toward quality scores and
 * baseline gating; synthetic cases (`realLog: false`) count toward format coverage
 * only. Real cases MUST be de-identified before entering git (see the README
 * annotation guide) and MUST state `deIdentified: true`.
 */

/**
 * Eval-only root-cause category enum (settled Q1-Q25: never part of the product
 * output contract). First version covers the charging/power pilot domain plus
 * generic categories; extend deliberately when new domains onboard.
 */
export const logEvalRootCauseCategories = [
  "thermal-protection",
  "communication-failure",
  "device-unavailable",
  "power-delivery-degradation",
  "configuration-error",
  "hardware-fault",
  "software-fault",
  "no-fault",
  "insufficient-evidence"
] as const;

export type LogEvalRootCauseCategory = (typeof logEvalRootCauseCategories)[number];

export const goldenCaseYamlSchema = z
  .object({
    /** Log domain slug the case belongs to; must match its directory. */
    domain: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "domain must be a lowercase slug"),
    /** One-line human summary of the scenario. */
    summary: z.string().min(1),
    /** true = de-identified real production log; false = synthetic (format coverage only). */
    realLog: z.boolean(),
    /** De-identification attestation; REQUIRED true when realLog is true. */
    deIdentified: z.boolean().optional(),
    rootCauseCategory: z.enum(logEvalRootCauseCategories),
    /** Expert-confirmed root-cause statements the conclusion must cover. */
    rootCausePoints: z.array(z.string().min(1)).default([]),
    /** 1-based raw line numbers of the decisive evidence. */
    keyEvidenceLines: z.array(z.number().int().positive()).default([]),
    expectedActions: z.array(z.string().min(1)).default([]),
    /** true = the honest outcome is a refusal / low-confidence answer, not a diagnosis. */
    expectRefusal: z.boolean().default(false),
    analysisQuestion: z.string().min(1).optional(),
    /** Optional declarative format profile applied when parsing log.txt (format-coverage cases). */
    formatProfile: z.unknown().optional()
  })
  .superRefine((value, context) => {
    if (value.realLog && value.deIdentified !== true) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deIdentified"],
        message: "realLog cases must attest deIdentified: true before entering the repository"
      });
    }
    if (!value.expectRefusal) {
      if (value.rootCausePoints.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rootCausePoints"],
          message: "non-refusal cases need at least one root-cause point"
        });
      }
      if (value.keyEvidenceLines.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["keyEvidenceLines"],
          message: "non-refusal cases need at least one key evidence line"
        });
      }
      if (value.expectedActions.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["expectedActions"],
          message: "non-refusal cases need at least one expected action"
        });
      }
    }
  });

export type GoldenCaseYaml = z.infer<typeof goldenCaseYamlSchema>;

export type GoldenLogCase = Omit<GoldenCaseYaml, "formatProfile"> & {
  /** `<domain>/<case-dir>` — stable identity in reports and baselines. */
  id: string;
  caseDir: string;
  logText: string;
  rawLines: string[];
  formatProfile?: LogFormatProfile;
};

export type LoadGoldenCasesResult = {
  cases: GoldenLogCase[];
  /** Human-readable validation problems; a non-empty list fails the eval run. */
  problems: string[];
};

export function defaultGoldenCasesRoot(projectRoot: string = process.cwd()): string {
  return path.join(projectRoot, "eval-cases", "logs");
}

function listDirectories(parent: string): string[] {
  return readdirSync(parent)
    .filter((name) => !name.startsWith("."))
    .map((name) => path.join(parent, name))
    .filter((candidate) => statSync(candidate).isDirectory())
    .sort();
}

/**
 * Loads and validates every case under the golden-set root. Validation problems
 * are collected (not thrown) so a run can report every broken case at once.
 */
export function loadGoldenLogCases(rootDir: string): LoadGoldenCasesResult {
  const cases: GoldenLogCase[] = [];
  const problems: string[] = [];

  for (const domainDir of listDirectories(rootDir)) {
    const domainSlug = path.basename(domainDir);
    for (const caseDir of listDirectories(domainDir)) {
      const caseId = `${domainSlug}/${path.basename(caseDir)}`;
      const yamlPath = path.join(caseDir, "case.yaml");
      const logPath = path.join(caseDir, "log.txt");

      let yamlText: string;
      let logText: string;
      try {
        yamlText = readFileSync(yamlPath, "utf8");
      } catch {
        problems.push(`${caseId}: missing case.yaml`);
        continue;
      }
      try {
        logText = readFileSync(logPath, "utf8");
      } catch {
        problems.push(`${caseId}: missing log.txt`);
        continue;
      }

      let parsedYaml: unknown;
      try {
        parsedYaml = parseYaml(yamlText);
      } catch (error) {
        problems.push(`${caseId}: case.yaml is not valid YAML (${error instanceof Error ? error.message : String(error)})`);
        continue;
      }

      const parsed = goldenCaseYamlSchema.safeParse(parsedYaml);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          problems.push(`${caseId}: ${issue.path.join(".") || "(root)"} — ${issue.message}`);
        }
        continue;
      }

      if (parsed.data.domain !== domainSlug) {
        problems.push(`${caseId}: domain "${parsed.data.domain}" does not match its directory "${domainSlug}"`);
        continue;
      }

      let formatProfile: LogFormatProfile | undefined;
      if (parsed.data.formatProfile !== undefined) {
        const profileResult = validateLogFormatProfile(parsed.data.formatProfile);
        if (!profileResult.ok) {
          problems.push(`${caseId}: formatProfile is invalid (${profileResult.issues.join("; ")})`);
          continue;
        }
        formatProfile = profileResult.profile;
      }

      const rawLines = logText.split(/\r\n|\n|\r/);
      const lineProblems = parsed.data.keyEvidenceLines.filter(
        (lineNumber) => lineNumber > rawLines.length || rawLines[lineNumber - 1].trim().length === 0
      );
      if (lineProblems.length > 0) {
        problems.push(
          `${caseId}: keyEvidenceLines reference missing or blank lines: ${lineProblems.join(", ")} (log has ${rawLines.length} lines)`
        );
        continue;
      }

      const { formatProfile: _rawProfile, ...caseFields } = parsed.data;
      cases.push({
        ...caseFields,
        id: caseId,
        caseDir,
        logText,
        rawLines,
        ...(formatProfile ? { formatProfile } : {})
      });
    }
  }

  return { cases, problems };
}
