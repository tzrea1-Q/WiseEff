import type { CorrelationContext } from "./correlation";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogRecordInput = {
  level: LogLevel;
  message: string;
  timestamp?: string;
  correlation?: CorrelationContext;
  fields?: Record<string, unknown>;
};

const secretKeyPattern = /(authorization|password|secret|token|api[_-]?key|access[_-]?key|refresh[_-]?token)/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function redactTelemetryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactTelemetryValue(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => [
      key,
      secretKeyPattern.test(key) ? "<redacted>" : redactTelemetryValue(fieldValue)
    ])
  );
}

export function createLogRecord(input: LogRecordInput) {
  return {
    timestamp: input.timestamp ?? new Date().toISOString(),
    level: input.level,
    message: input.message,
    ...input.correlation,
    ...(redactTelemetryValue(input.fields ?? {}) as Record<string, unknown>)
  };
}

export function writeStructuredLog(input: LogRecordInput, writer: Pick<typeof console, "log"> = console) {
  const record = createLogRecord(input);
  writer.log(JSON.stringify(record));
  return record;
}
