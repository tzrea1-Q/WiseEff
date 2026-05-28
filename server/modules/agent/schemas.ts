import { z } from "zod";

export const agentContextSchema = z.object({
  path: z.string().min(1),
  pageKey: z.string().min(1),
  projectId: z.string().min(1).optional(),
  roleId: z.string().min(1).optional()
});

export const createAgentSessionBodySchema = z.object({
  context: agentContextSchema
});

export const sendAgentMessageBodySchema = z.object({
  message: z.string().trim().min(1).max(4000)
});

export const runAgentToolCallBodySchema = z.object({
  payload: z.record(z.unknown()).default({})
});

export const approveAgentApprovalBodySchema = z.object({
  expectedToolCallStatus: z.literal("pending_approval").optional()
});

export const rejectAgentApprovalBodySchema = z.object({
  reason: z.string().trim().min(1).max(500).optional()
});
