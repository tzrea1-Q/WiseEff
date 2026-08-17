/**
 * Before/after for spec-editor save confirm (SE-D5).
 * Compares the loaded detail against the payload that `buildSpecEditorSavePayload` will send.
 */

export type SpecEditorSaveDiffSource = {
  valueShape?: Record<string, unknown> | null;
  constraints?: Record<string, unknown> | null;
};

export type SpecEditorSaveDiff = {
  valueShapeChanged: boolean;
  constraintsChanged: boolean;
  previousValueShape: Record<string, unknown>;
  nextValueShape: Record<string, unknown>;
  previousConstraints: Record<string, unknown>;
  nextConstraints: Record<string, unknown>;
};

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function stablePrettyJson(value: unknown): string {
  return JSON.stringify(canonicalize(value), null, 2);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function specEditorSaveDiff(
  detail: SpecEditorSaveDiffSource,
  payload: SpecEditorSaveDiffSource,
): SpecEditorSaveDiff {
  const previousValueShape = asObject(detail.valueShape);
  const nextValueShape = asObject(payload.valueShape);
  const previousConstraints = asObject(detail.constraints);
  const nextConstraints = asObject(payload.constraints);
  return {
    valueShapeChanged: !jsonEqual(previousValueShape, nextValueShape),
    constraintsChanged: !jsonEqual(previousConstraints, nextConstraints),
    previousValueShape,
    nextValueShape,
    previousConstraints,
    nextConstraints,
  };
}
