import { z } from "zod";

export const consumerFamilyIds = [
  "S12-CGH",
  "S12-TOP",
  "S12-PRJ",
  "S12-FIL",
  "S12-AGT",
  "S12-LOG",
  "S12-DBG",
  "S12-DTS",
  "S12-KNW",
  "S12-MOD",
  "S12-OPS",
] as const;

export type ConsumerFamilyId = (typeof consumerFamilyIds)[number];

export const boundaryRuleIds = [
  "legacy-catalog-sql-write",
  "legacy-catalog-raw-read",
  "canonical-catalog-raw-access",
  "legacy-catalog-table-name",
  "legacy-parameter-spec-identifier",
  "legacy-catalog-module-import",
  "forbidden-catalog-internal-import",
  "legacy-catalog-route",
  "legacy-effective-governance-contract",
  "legacy-overlay-catalog-contract",
] as const;

export type BoundaryRuleId = (typeof boundaryRuleIds)[number];

const consumerFamilyIdSchema = z.enum(consumerFamilyIds);
const boundaryRuleIdSchema = z.enum(boundaryRuleIds);
const repoPathSchema = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), "repository paths must not have surrounding whitespace")
  .refine((value) => !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."), {
    message: "repository paths must be normalized relative POSIX paths",
  });
const violationIdSchema = z.string().regex(
  /^S12-(?:CGH|TOP|PRJ|FIL|AGT|LOG|DBG|DTS|KNW|MOD|OPS):[a-z0-9-]+:[a-f0-9]{16}:[1-9][0-9]*$/u,
  "violation IDs must use the stable family:rule:fingerprint:ordinal form",
);
const nonBlankSchema = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), "value must not have surrounding whitespace");

export const allowlistEntrySchema = z
  .object({
    id: violationIdSchema,
    rule: boundaryRuleIdSchema,
    file: repoPathSchema,
    reason: nonBlankSchema,
  })
  .strict();

export type AllowlistEntry = z.infer<typeof allowlistEntrySchema>;

export const boundaryViolationSchema = allowlistEntrySchema
  .extend({
    family: consumerFamilyIdSchema,
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    evidence: nonBlankSchema,
  })
  .strict();

export type BoundaryViolation = z.infer<typeof boundaryViolationSchema>;

export const allowlistShardSchema = z
  .object({
    schemaVersion: z.literal(1),
    family: consumerFamilyIdSchema,
    root: repoPathSchema,
    entries: z.array(allowlistEntrySchema),
  })
  .strict()
  .superRefine((shard, context) => {
    validateUniqueSortedIds(shard.entries, context);
    for (const [index, entry] of shard.entries.entries()) {
      if (!entry.id.startsWith(`${shard.family}:`)) {
        context.addIssue({
          code: "custom",
          message: `entry ID belongs to a different family than ${shard.family}`,
          path: ["entries", index, "id"],
        });
      }
      if (entry.rule !== entry.id.split(":")[1]) {
        context.addIssue({
          code: "custom",
          message: "entry rule does not match its stable ID",
          path: ["entries", index, "rule"],
        });
      }
      if (entry.file !== shard.root && !entry.file.startsWith(`${shard.root}/`)) {
        context.addIssue({
          code: "custom",
          message: `entry file is outside family root ${shard.root}`,
          path: ["entries", index, "file"],
        });
      }
    }
  });

export type AllowlistShard = z.infer<typeof allowlistShardSchema>;

export const boundaryViolationFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    baselineSha: z.string().regex(/^[a-f0-9]{40}$/u, "baselineSha must be a full Git commit SHA"),
    violations: z.array(boundaryViolationSchema),
  })
  .strict()
  .superRefine((fixture, context) => {
    validateUniqueSortedIds(fixture.violations, context, ["violations"]);
    for (const [index, violation] of fixture.violations.entries()) {
      if (!violation.id.startsWith(`${violation.family}:`)) {
        context.addIssue({
          code: "custom",
          message: "violation ID belongs to a different family",
          path: ["violations", index, "id"],
        });
      }
      if (violation.rule !== violation.id.split(":")[1]) {
        context.addIssue({
          code: "custom",
          message: "violation rule does not match its stable ID",
          path: ["violations", index, "rule"],
        });
      }
    }
  });

export type BoundaryViolationFixture = z.infer<typeof boundaryViolationFixtureSchema>;

function validateUniqueSortedIds(
  entries: readonly { id: string }[],
  context: z.RefinementCtx,
  pathPrefix: Array<string | number> = ["entries"],
) {
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (seen.has(entry.id)) {
      context.addIssue({
        code: "custom",
        message: `duplicate violation ID: ${entry.id}`,
        path: [...pathPrefix, index, "id"],
      });
    }
    seen.add(entry.id);

    if (index > 0 && compareText(entries[index - 1].id, entry.id) >= 0) {
      context.addIssue({
        code: "custom",
        message: "entries must be strictly sorted by stable violation ID",
        path: [...pathPrefix, index, "id"],
      });
    }
  }
}

export function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
