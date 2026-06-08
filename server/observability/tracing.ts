export type TraceExporter = (span: {
  name: string;
  attributes: Record<string, string | number | boolean>;
  startedAt: string;
  endedAt: string;
}) => Promise<void> | void;

export type TracingBoundaryOptions = {
  enabled: boolean;
  serviceName: string;
  exporter?: TraceExporter;
};

export function createTracingBoundary(options: TracingBoundaryOptions) {
  let droppedExportCount = 0;

  return {
    isEnabled() {
      return options.enabled;
    },
    getTraceId(input: { requestId?: string; traceId?: string }) {
      return input.traceId?.trim() || input.requestId?.trim();
    },
    getDroppedExportCount() {
      return droppedExportCount;
    },
    async withSpan<T>(name: string, attributes: Record<string, string | number | boolean>, fn: () => Promise<T> | T): Promise<T> {
      const startedAt = new Date().toISOString();
      try {
        return await fn();
      } finally {
        if (options.enabled && options.exporter) {
          try {
            await options.exporter({
              name,
              attributes: {
                service: options.serviceName,
                ...attributes
              },
              startedAt,
              endedAt: new Date().toISOString()
            });
          } catch {
            droppedExportCount += 1;
          }
        }
      }
    }
  };
}

export const defaultTracingBoundary = createTracingBoundary({
  enabled: process.env.WISEEFF_OTEL_ENABLED === "true",
  serviceName: "wiseeff-api"
});
