import { z } from "zod";

export const subjectIdentityChangeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("rename-subject"), subjectId: z.string().min(1),
    selector: z.string().min(1), keepOldAlias: z.boolean() }).strict(),
  z.object({ op: z.literal("set-subject-alias"), subjectId: z.string().min(1),
    selector: z.string().min(1), active: z.boolean(), fromSubjectId: z.string().min(1).optional() }).strict(),
]);

export type SubjectIdentityChange = z.infer<typeof subjectIdentityChangeSchema>;
export const isSubjectIdentityOp = (op: string): op is SubjectIdentityChange["op"] =>
  op === "rename-subject" || op === "set-subject-alias";

export const subjectIdentityImpactSchema = z.object({
  change: subjectIdentityChangeSchema,
  subjects: z.array(z.object({
    id: z.string(), canonicalName: z.string(), ownerSubjectId: z.string().optional(),
    definitionCount: z.number().int().nonnegative(),
  }).strict()),
}).strict();

export type SubjectIdentityImpact = z.infer<typeof subjectIdentityImpactSchema>;
