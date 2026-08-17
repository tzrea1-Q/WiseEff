import type { z, ZodTypeAny } from "zod";

import { WiseEffApiError } from "./apiClient";

/**
 * Parse a successful API JSON body against the contract Zod schema.
 * Failures stay on the existing WiseEffApiError envelope (`INTERNAL_ERROR` +
 * `details.reason = contract-drift`); this is not a second error shape.
 */
export function parseContractDto<T extends ZodTypeAny>(schema: T, value: unknown, schemaName: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new WiseEffApiError(
      "INTERNAL_ERROR",
      "API response did not match the contract schema.",
      {
        reason: "contract-drift",
        schemaName,
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
          message: issue.message
        }))
      },
      ""
    );
  }
  return result.data;
}
