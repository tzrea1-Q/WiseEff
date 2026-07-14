import type { DtsStructuredRepository } from "@/application/ports/DtsStructuredRepository";
import { createDtsStructuredClient } from "@/infrastructure/http/dtsStructuredClient";
import { wiseEffRuntimeMode, type WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { createMockDtsStructuredRepository } from "@/infrastructure/mock/mockDtsStructuredRepository";

type ResolveOptions = {
  mode?: WiseEffRuntimeMode;
  createMock?: typeof createMockDtsStructuredRepository;
  createHttp?: typeof createDtsStructuredClient;
};

/**
 * Pick mock vs HTTP DtsStructuredRepository from runtime mode.
 * App/UI should inject the result; panels must not construct clients directly.
 */
export function resolveDtsStructuredRepository(modeOrOptions: WiseEffRuntimeMode | ResolveOptions = {}): DtsStructuredRepository {
  const options: ResolveOptions =
    typeof modeOrOptions === "string" ? { mode: modeOrOptions } : modeOrOptions;
  const mode = options.mode ?? wiseEffRuntimeMode;
  const createMock = options.createMock ?? createMockDtsStructuredRepository;
  const createHttp = options.createHttp ?? createDtsStructuredClient;

  if (mode === "mock") {
    return createMock();
  }
  return createHttp();
}
