import { z } from "zod";
import { debugConnectionProtocols, defaultDebugConnectionProtocol } from "./protocol";
import { debugAccessModes } from "./status";

const nonEmptyString = z.string().trim().min(1);
const protocolSchema = z.enum(debugConnectionProtocols).default(defaultDebugConnectionProtocol);
const nodePathSchema = z
  .string()
  .trim()
  .min(1)
  .startsWith("/")
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), { message: "Node path must not contain control characters." });

export const debugParameterNodeBindingSchema = z.object({
  protocol: z.enum(debugConnectionProtocols),
  nodePath: nodePathSchema,
  accessMode: z.enum(debugAccessModes),
  enabled: z.boolean().default(true),
  notes: z.string().trim().optional()
});

export const listDebuggingParametersQuerySchema = z.object({
  projectId: nonEmptyString.optional(),
  module: nonEmptyString.optional(),
  risk: z.union([nonEmptyString, z.array(nonEmptyString)]).optional(),
  protocol: protocolSchema.optional()
});

export const detectTargetsBodySchema = z.object({
  projectId: nonEmptyString,
  deviceId: nonEmptyString.optional(),
  protocol: protocolSchema
});

export const createDebugSessionBodySchema = z.object({
  projectId: nonEmptyString,
  deviceId: nonEmptyString,
  targetId: nonEmptyString,
  protocol: protocolSchema
});

export const readNodeBodySchema = z
  .object({
    sessionId: nonEmptyString,
    parameterId: nonEmptyString.optional(),
    nodePath: nodePathSchema.optional()
  })
  .refine((value) => Boolean(value.parameterId ?? value.nodePath), {
    message: "Either parameterId or nodePath is required.",
    path: ["parameterId"]
  });

export const writeNodeBodySchema = z.object({
  sessionId: nonEmptyString,
  parameterId: nonEmptyString,
  nodePath: nodePathSchema.optional(),
  value: nonEmptyString,
  readBack: z.boolean().default(true),
  approvalId: nonEmptyString.optional(),
  confirmationToken: nonEmptyString.optional(),
  expectedPreviousValue: nonEmptyString.optional()
});

export const rollbackSnapshotBodySchema = z.object({
  confirmationToken: nonEmptyString
});
