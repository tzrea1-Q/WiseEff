import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export const listDebuggingParametersQuerySchema = z.object({
  projectId: nonEmptyString.optional(),
  module: nonEmptyString.optional(),
  risk: z.union([nonEmptyString, z.array(nonEmptyString)]).optional()
});

export const detectTargetsBodySchema = z.object({
  projectId: nonEmptyString,
  deviceId: nonEmptyString.optional()
});

export const createDebugSessionBodySchema = z.object({
  projectId: nonEmptyString,
  deviceId: nonEmptyString,
  targetId: nonEmptyString
});

export const readNodeBodySchema = z.object({
  sessionId: nonEmptyString,
  parameterId: nonEmptyString.optional(),
  nodePath: nonEmptyString
});

export const writeNodeBodySchema = z.object({
  sessionId: nonEmptyString,
  parameterId: nonEmptyString,
  nodePath: nonEmptyString,
  value: nonEmptyString,
  readBack: z.boolean().default(true),
  approvalId: nonEmptyString.optional(),
  confirmationToken: nonEmptyString.optional(),
  expectedPreviousValue: nonEmptyString.optional()
});

export const rollbackSnapshotBodySchema = z.object({
  confirmationToken: nonEmptyString
});
