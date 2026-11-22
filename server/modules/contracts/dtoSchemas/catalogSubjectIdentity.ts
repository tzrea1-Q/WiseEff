import { z } from "zod";

const subjectId = z.string().min(1);
const nature = z.enum(["physical-device", "logical-service"]);
const cardinality = z.enum(["multiple", "singleton-per-project"]);
const replacement = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("driver"), selector: z.string().min(1), nature, cardinality }).strict(),
  z.object({ kind: z.enum(["node-type", "configuration-schema"]), selector: z.string().min(1) }).strict(),
]);

export const subjectRulesChangeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set-driver-defaults"), subjectId, nature, cardinality }).strict(),
  z.object({ op: z.literal("change-subject-owner"), subjectId, ownerSubjectId: subjectId.nullable() }).strict(),
  z.object({ op: z.literal("retire-subject"), subjectId, successorSubjectId: subjectId.optional(),
    inheritChildren: z.boolean().optional() }).strict(),
  z.object({ op: z.literal("restore-subject"), subjectId }).strict(),
  z.object({ op: z.literal("replace-subject-kind"), subjectId, replacement }).strict(),
]);
export type SubjectRulesChange = z.infer<typeof subjectRulesChangeSchema>;
export const isSubjectRulesOp = (op: string): op is SubjectRulesChange["op"] =>
  subjectRulesChangeSchema.options.some(option => option.shape.op.value === op);

export const subjectIdentityChangeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("rename-subject"), subjectId: z.string().min(1),
    selector: z.string().min(1), keepOldAlias: z.boolean() }).strict(),
  z.object({ op: z.literal("set-subject-alias"), subjectId: z.string().min(1),
    selector: z.string().min(1), active: z.boolean(), fromSubjectId: z.string().min(1).optional() }).strict(),
  ...subjectRulesChangeSchema.options,
]);

export type SubjectIdentityChange = z.infer<typeof subjectIdentityChangeSchema>;
export const isSubjectIdentityOp = (op: string): op is SubjectIdentityChange["op"] =>
  op === "rename-subject" || op === "set-subject-alias" || isSubjectRulesOp(op);

const subjectState = z.object({
  kind: z.enum(["driver", "node-type", "configuration-schema"]), selector: z.string(),
  ownerSubjectId: subjectId.nullable(), lifecycle: z.enum(["active", "retired"]),
  defaults: z.object({ nature, cardinality }).optional(),
}).strict();
export const subjectRulesConflictSchema = z.enum(["singleton-project", "owner-registration-required",
  "organization-selector-collision", "organization-driver-override"]);
const count = z.number().int().nonnegative();
export const subjectRulesImpactSchema = z.object({
  before: subjectState, after: subjectState,
  successor: subjectState.extend({ id: subjectId }).optional(),
  children: z.array(z.object({ id: subjectId, selector: z.string(), inherited: z.boolean() }).strict()),
  definitions: z.array(z.object({ id: z.string(), propertyKey: z.string(), subjectId }).strict()),
  registrationCounts: z.object({ active: count, independentlyRetired: count, cascadeRetired: count,
    ownerOverrides: count, recognitionOverrides: count, sharedSuspended: count }).strict(),
  registrations: z.array(z.object({ id: z.string(), organizationId: z.string().optional(), subjectId, status: z.enum(["active", "retired"]),
    cascadeRetired: z.boolean(), ownerOverride: subjectId.nullable(), cardinalityOverride: cardinality.nullable(),
    recognitionOverride: z.boolean().optional(), natureOverride: nature.nullable().optional(), sharedSuspended: z.boolean().optional() }).strict()),
  projectCount: count, bindingCount: count,
  projects: z.array(z.object({ id: z.string(), organizationId: z.string().optional(), bindingCount: count, instanceCount: count }).strict()),
  conflictCounts: z.array(z.object({ reason: subjectRulesConflictSchema, count }).strict()),
  conflicts: z.array(z.object({ reason: subjectRulesConflictSchema, organizationId: z.string().optional(), projectId: z.string().optional(),
    subjectId: subjectId.optional(), instanceCount: count.optional() }).strict()),
}).strict();
export type SubjectRulesImpact = z.infer<typeof subjectRulesImpactSchema>;

export const subjectIdentityImpactSchema = z.object({
  change: subjectIdentityChangeSchema,
  subjects: z.array(z.object({
    id: z.string(), canonicalName: z.string(), ownerSubjectId: z.string().optional(),
    definitionCount: z.number().int().nonnegative(),
  }).strict()),
  rules: subjectRulesImpactSchema.optional(),
}).strict();

export type SubjectIdentityImpact = z.infer<typeof subjectIdentityImpactSchema>;
