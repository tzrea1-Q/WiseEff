import { sanitizeGate0DiagnosticText } from "../gate0-artifact-sanitizer";

export const writeSanitizedCutoverOutput = (value: unknown): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return sanitizeGate0DiagnosticText(`${text}\n`).value;
};
