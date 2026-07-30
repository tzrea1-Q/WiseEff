import { ApiError } from "../../shared/http/errors";
import { isStructuralPropertyKey } from "../../../src/domain/parameter-topology/parameterSurface";

/**
 * Fail closed before any ParameterSpec write path can invent a structural key.
 * DB CHECK on dts_property_specs is defense in depth; callers should surface a
 * typed 400 instead of a constraint violation.
 */
export function assertNonStructuralPropertyKey(propertyKey: string): void {
  if (!isStructuralPropertyKey(propertyKey)) return;
  throw new ApiError(
    "VALIDATION_FAILED",
    `Structural DTS property "${propertyKey.trim()}" is not a parameter definition (ADR-0003).`,
    400,
    { propertyKey: propertyKey.trim() },
  );
}
