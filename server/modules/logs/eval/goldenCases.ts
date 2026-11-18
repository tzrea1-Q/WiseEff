import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { bundleFileUtf8Bytes, intakeLogBundle } from "../bundleIntake";
import type { LogFileDto } from "../filesRepository";
import { validateLogFormatProfile, type LogFormatProfile } from "../formatProfile";
import { logSkillSpecSchema, type LogSkillSpec } from "../skillSpec";

/**
 * The labelled corpus under `eval-cases/logs/<domain>/<case-id>/` anchors the
 * quality-layer eval. Only de-identified production cases (golden) gate the baseline.
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

export const logEvalScenarioTags = [
  "multi-file", "large-bundle", "cascade", "distractor", "register-decoding", "configuration",
  "resource-exhaustion", "android", "clock-skew", "multi-issue", "truncated", "no-fault",
  "prompt-injection", "encoding", "public-labelled", "generic-analysis"
] as const;

const checklistNote = z.string().trim().min(1);
export const logEvalCaseMetadataSchema = z.object({
  tier: z.enum(["golden", "realistic", "synthetic"]).optional(),
  provenance: z.enum(["production", "public-dataset", "authored"]).optional(),
  scenarioTags: z.array(z.enum(logEvalScenarioTags)).optional(),
  datasetSource: z.object({
    name: z.string().trim().min(1),
    version: z.string().trim().min(1),
    url: z.string().url(),
    license: z.string().trim().min(1),
    file: z.string().trim().min(1),
    lines: z.tuple([z.number().int().positive(), z.number().int().positive()])
      .refine(([start, end]) => end >= start, "结束行号不能小于起始行号")
  }).optional(),
  realismChecklist: z.object({
    lineFormat: checklistNote,
    noiseRatio: checklistNote,
    distractors: checklistNote,
    rootCauseDiscoverability: checklistNote,
    timeline: checklistNote,
    sensitiveData: checklistNote,
    annotationReview: checklistNote
  }).optional()
});

export function resolveLogEvalCaseMetadata(value: Pick<GoldenCaseYaml, "realLog" | "tier" | "provenance" | "scenarioTags">) {
  return {
    tier: value.tier ?? (value.realLog ? "golden" : "synthetic"),
    provenance: value.provenance ?? (value.realLog ? "production" : "authored"),
    scenarioTags: value.scenarioTags ?? []
  } as const;
}

export const goldenCaseYamlSchema = z
  .object({
    ...logEvalCaseMetadataSchema.shape,
    /** Log domain slug the case belongs to; must match its directory. */
    domain: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "domain must be a lowercase slug"),
    /** One-line human summary of the scenario. */
    summary: z.string().min(1),
    /** true = de-identified production log; false = realistic or synthetic. */
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
    formatProfile: z.unknown().optional(),
    bundleFiles: z.array(z.string().min(1).max(1024)).min(1).max(100).optional()
  })
  .superRefine((value, context) => {
    const { tier, provenance } = resolveLogEvalCaseMetadata(value);
    const allowed = {
      golden: ["production"], realistic: ["public-dataset", "authored"], synthetic: ["authored"]
    };
    if (!allowed[tier].includes(provenance)) {
      context.addIssue({ code: "custom", path: ["provenance"], message: `层级 ${tier} 不支持来源 ${provenance}` });
    }
    if (value.realLog !== (provenance === "production")) {
      context.addIssue({ code: "custom", path: ["realLog"], message: "生产来源的 realLog 须为 true，其他来源须为 false" });
    }
    if (tier === "realistic" && value.deIdentified !== undefined) {
      context.addIssue({ code: "custom", path: ["deIdentified"], message: "仿真用例不能声明 deIdentified" });
    }
    if (provenance === "public-dataset" && !value.datasetSource) {
      context.addIssue({ code: "custom", path: ["datasetSource"], message: "公开数据集用例须填写 datasetSource" });
    }
    // Legacy synthetic format-coverage seeds predate authorship metadata.
    if (provenance === "authored" && (value.tier !== undefined || value.provenance !== undefined) && !value.realismChecklist) {
      context.addIssue({ code: "custom", path: ["realismChecklist"], message: "Agent 编写的用例须填写 realismChecklist" });
    }
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
  skill?: LogSkillSpec;
  bundle?: Array<LogFileDto & { logText: string }>;
};

export type LoadGoldenCasesResult = {
  cases: Array<GoldenLogCase & ReturnType<typeof resolveLogEvalCaseMetadata>>;
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

function loadCaseBundle(caseDir: string, fixturePaths: string[]): NonNullable<GoldenLogCase["bundle"]> {
  const root = realpathSync(caseDir);
  const intake = intakeLogBundle(fixturePaths.map((fixture) => {
    if (fixture === "case.yaml" || /[\\\0:]/.test(fixture)
      || fixture.split("/").some((part) => part === "" || part === "." || part === "..")) {
      throw new Error(`unsafe fixture path: ${fixture}`);
    }
    const target = realpathSync(path.join(root, fixture));
    if (!target.startsWith(root + path.sep) || !statSync(target).isFile()) {
      throw new Error(`fixture must be a file inside the case: ${fixture}`);
    }
    return { fileName: fixture.replace(/^fixtures\//, ""), bytes: readFileSync(target) };
  }));
  if (!intake.ok) throw new Error(intake.reason);
  const analyzed = intake.files.filter((file) => file.status === "analyzed");
  if (!analyzed.length) throw new Error("no analyzable fixture files");
  return analyzed.map((file) => {
    const { sha256: _sha256, bytes: _bytes, ...metadata } = file;
    return { ...metadata, logText: bundleFileUtf8Bytes(file).toString("utf8") };
  });
}

/**
 * Loads and validates every case under the golden-set root. Validation problems
 * are collected (not thrown) so a run can report every broken case at once.
 */
export function loadGoldenLogCases(rootDir: string): LoadGoldenCasesResult {
  const cases: LoadGoldenCasesResult["cases"] = [];
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
      const skillPath = path.join(caseDir, "skill.yaml");
      let skill: LogSkillSpec | undefined;
      if (existsSync(skillPath)) {
        try {
          skill = logSkillSpecSchema.parse(parseYaml(readFileSync(skillPath, "utf8")));
        } catch (error) {
          problems.push(`${caseId}: skill.yaml — ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      }
      let bundle: GoldenLogCase["bundle"];
      if (caseFields.bundleFiles) {
        try {
          bundle = loadCaseBundle(caseDir, caseFields.bundleFiles);
          const normalize = (text: string) => text.replace(/\r\n|\r/g, "\n").replace(/\n$/, "");
          if (bundle.map((file) => normalize(file.logText)).join("\n") !== normalize(logText)) {
            problems.push(`${caseId}: log.txt must match the flattened bundleFiles projection`);
            continue;
          }
        } catch (error) {
          problems.push(`${caseId}: bundleFiles — ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      }
      cases.push({
        ...caseFields,
        ...resolveLogEvalCaseMetadata(caseFields),
        id: caseId,
        caseDir,
        logText,
        rawLines,
        ...(formatProfile ? { formatProfile } : {}),
        ...(skill ? { skill } : {}),
        ...(bundle ? { bundle } : {})
      });
    }
  }

  return { cases, problems };
}
