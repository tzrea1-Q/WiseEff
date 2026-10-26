import { z } from "zod";
import { WORKFLOW_IDS, type WorkflowId } from "../../../src/domain/workflowDiscovery";

export const workflowPublicationValuesSchema = z.object(
  Object.fromEntries(WORKFLOW_IDS.map((id) => [id, z.boolean()])) as Record<WorkflowId, z.ZodBoolean>
).strict();

export const updateWorkflowPublicationSchema = z.object({
  workflows: workflowPublicationValuesSchema,
  expectedVersion: z.number().int().nonnegative().max(2_147_483_647)
}).strict();

export const workflowPublicationStateSchema = z.object({
  workflows: workflowPublicationValuesSchema,
  version: z.number().int().nonnegative()
}).strict();

export const workflowPublicationAdminStateSchema = workflowPublicationStateSchema.extend({
  updatedAt: z.string().datetime().nullable(),
  updatedBy: z.object({ id: z.string().min(1), name: z.string() }).strict().nullable()
});
