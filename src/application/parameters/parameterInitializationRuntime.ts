import type { ParameterInitializationRepository } from "@/application/ports/ParameterInitializationRepository";
import { createHttpParameterInitializationRepository } from "@/infrastructure/http/parameterInitializationClient";
import { wiseEffRuntimeMode, type WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { createMockParameterInitializationRepository } from "@/infrastructure/mock/mockParameterInitializationRepository";

type ResolveOptions = {
  mode?: WiseEffRuntimeMode;
  createMock?: typeof createMockParameterInitializationRepository;
  createHttp?: typeof createHttpParameterInitializationRepository;
};

/**
 * Pick mock vs HTTP ParameterInitializationRepository from runtime mode.
 */
export function resolveParameterInitializationRepository(
  modeOrOptions: WiseEffRuntimeMode | ResolveOptions = {}
): ParameterInitializationRepository {
  const options: ResolveOptions = typeof modeOrOptions === "string" ? { mode: modeOrOptions } : modeOrOptions;
  const mode = options.mode ?? wiseEffRuntimeMode;
  const createMock = options.createMock ?? createMockParameterInitializationRepository;
  const createHttp = options.createHttp ?? createHttpParameterInitializationRepository;

  if (mode === "mock") {
    return createMock();
  }
  return createHttp();
}
