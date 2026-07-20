import { z } from "zod";

const nonEmptyString = z.string().min(1);

const dtsCellSchema: z.ZodType<{ kind: "integer"; raw: string; value: string } | { kind: "phandle"; label: string }> =
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("integer"), raw: z.string(), value: z.string() }),
    z.object({ kind: z.literal("phandle"), label: z.string() })
  ]);

const dtsValueSegmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("string"), raw: z.string(), value: z.string() }),
  z.object({
    kind: z.literal("cells"),
    bits: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]),
    cells: z.array(dtsCellSchema)
  })
]);

/** Locked domain DtsValue — never path-derived identity. */
export const dtsValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("boolean"), present: z.literal(true) }),
  z.object({ kind: z.literal("empty") }),
  z.object({
    kind: z.literal("strings"),
    values: z.array(z.string()),
    items: z.array(z.object({ value: z.string(), raw: z.string() })).optional()
  }),
  z.object({
    kind: z.literal("cells"),
    bits: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]),
    groups: z.array(z.array(dtsCellSchema))
  }),
  z.object({ kind: z.literal("bytes"), values: z.array(z.number().int()) }),
  z.object({ kind: z.literal("mixed"), segments: z.array(dtsValueSegmentSchema) })
]);

export const projectBindingDtoSchema = z.object({
  id: z.string(),
  parameterSpecId: z.string(),
  parameterSpecVersionId: z.string(),
  propertyKey: z.string(),
  driverModule: z.string().nullable(),
  logicalNodeId: z.string().nullable(),
  instanceName: z.string().nullable(),
  locator: z.string().nullable(),
  effectiveValue: dtsValueSchema,
  rawValue: z.string(),
  schemaState: z.enum(["valid", "invalid", "unreviewed"]),
  policyState: z.enum(["pass", "fail", "not_applicable"]),
  /** Durable v1 business module (phase 2, §5.1 read path) — browse source of truth. */
  moduleId: z.string()
});

export const topologyViewSchema = z.enum(["source", "effective"]);

export const topologyParamsSchema = z.object({
  projectId: nonEmptyString,
  configSetId: nonEmptyString,
  revisionId: nonEmptyString
});

export const topologyQuerySchema = z.object({
  view: topologyViewSchema.default("effective")
});

export const projectBindingsParamsSchema = z.object({
  projectId: nonEmptyString
});

export const projectBindingsQuerySchema = z.object({
  revisionId: nonEmptyString.optional()
});

export const listIdentityMappingTasksQuerySchema = z.object({
  projectId: nonEmptyString.optional(),
  status: z.enum(["open", "resolved", "dismissed"]).optional()
});

export const identityMappingTaskParamsSchema = z.object({
  taskId: nonEmptyString
});

export const resolveIdentityMappingTaskBodySchema = z
  .object({
    decision: z.enum(["resolved", "dismissed"]),
    selectedLogicalNodeId: nonEmptyString.optional(),
    reason: nonEmptyString
  })
  .superRefine((value, ctx) => {
    if (value.decision === "resolved" && !value.selectedLogicalNodeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "selectedLogicalNodeId is required when resolving a mapping task.",
        path: ["selectedLogicalNodeId"]
      });
    }
  });

export const validateConfigRevisionParamsSchema = z.object({
  projectId: nonEmptyString,
  revisionId: nonEmptyString
});

export const validateConfigRevisionBodySchema = z.object({
  stage: z.string().min(1).optional()
});

export const createBindingDraftParamsSchema = z.object({
  projectId: nonEmptyString,
  bindingId: nonEmptyString
});

export const bindingHistoryParamsSchema = z.object({
  projectId: nonEmptyString,
  bindingId: nonEmptyString
});

export const bindingHistoryEntryDtoSchema = z.object({
  id: z.string(),
  changedAt: z.string(),
  fromRawValue: z.string().nullable().optional(),
  toRawValue: z.string().nullable().optional()
});

export const bindingCompareParamsSchema = z.object({
  projectId: nonEmptyString,
  bindingId: nonEmptyString
});

export const bindingCompareEntryDtoSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  rawValue: z.string(),
  moduleName: z.string().nullable().optional(),
  driverModule: z.string().nullable().optional()
});

export const createBindingDraftBodySchema = z
  .object({
    baseRevisionId: nonEmptyString,
    targetValue: dtsValueSchema.optional(),
    action: z.enum(["set", "delete"]).optional(),
    reason: nonEmptyString
  })
  .superRefine((value, ctx) => {
    const action = value.action ?? "set";
    if (action === "set" && value.targetValue === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetValue is required when action is set.",
        path: ["targetValue"]
      });
    }
  });

export type ProjectBindingDto = z.infer<typeof projectBindingDtoSchema>;
export type TopologyView = z.infer<typeof topologyViewSchema>;
export type ResolveIdentityMappingTaskBody = z.infer<typeof resolveIdentityMappingTaskBodySchema>;
export type DtsValueDto = z.infer<typeof dtsValueSchema>;
export type CreateBindingDraftBody = z.infer<typeof createBindingDraftBodySchema>;
