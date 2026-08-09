import type { AuditQuery } from "@/application/ports/AuditQuery";
import { createAuditClient } from "@/infrastructure/http/auditClient";
import { wiseEffRuntimeMode, type WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";

type ResolveOptions = {
  mode?: WiseEffRuntimeMode;
  createMock?: () => AuditQuery;
  createHttp?: () => AuditQuery;
};

function createEmptyMockAuditQuery(): AuditQuery {
  return {
    async listAuditEvents() {
      return { items: [], nextCursor: null };
    }
  };
}

/**
 * Resolve read-side audit listing for Activity projections.
 * UI must inject the result; workbench pages must not construct audit HTTP clients.
 */
export function resolveAuditQuery(modeOrOptions: WiseEffRuntimeMode | ResolveOptions = {}): AuditQuery {
  const options: ResolveOptions =
    typeof modeOrOptions === "string" ? { mode: modeOrOptions } : modeOrOptions;
  const mode = options.mode ?? wiseEffRuntimeMode;
  const createMock = options.createMock ?? createEmptyMockAuditQuery;
  const createHttp = options.createHttp ?? (() => createAuditClient());

  if (mode === "mock") {
    return createMock();
  }
  return createHttp();
}
