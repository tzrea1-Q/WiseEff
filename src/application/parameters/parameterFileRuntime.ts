import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import { createParameterFileClient } from "@/infrastructure/http/parameterFileClient";
import { wiseEffRuntimeMode, type WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { createMockParameterFileRepository } from "@/infrastructure/mock/mockParameterFileRepository";

type ResolveOptions = {
  mode?: WiseEffRuntimeMode;
  createMock?: typeof createMockParameterFileRepository;
  createHttp?: typeof createParameterFileClient;
};

/**
 * Pick mock vs HTTP ParameterFileRepository from runtime mode.
 * App/UI should inject the result; panels must not construct clients directly.
 */
export function resolveParameterFileRepository(modeOrOptions: WiseEffRuntimeMode | ResolveOptions = {}): ParameterFileRepository {
  const options: ResolveOptions = typeof modeOrOptions === "string" ? { mode: modeOrOptions } : modeOrOptions;
  const mode = options.mode ?? wiseEffRuntimeMode;
  const createMock = options.createMock ?? createMockParameterFileRepository;
  const createHttp = options.createHttp ?? createParameterFileClient;

  if (mode === "mock") {
    return createMock();
  }
  return createHttp();
}
