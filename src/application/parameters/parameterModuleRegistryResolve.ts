import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import { createHttpParameterModuleRegistryRepository } from "@/infrastructure/http/parameterModuleRegistryClient";
import { wiseEffRuntimeMode, type WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { createMockParameterModuleRegistryRepository } from "@/infrastructure/mock/mockParameterModuleRegistryRepository";

type ResolveOptions = {
  mode?: WiseEffRuntimeMode;
  createMock?: typeof createMockParameterModuleRegistryRepository;
  createHttp?: typeof createHttpParameterModuleRegistryRepository;
};

/**
 * Pick mock vs HTTP ParameterModuleRegistryRepository from runtime mode.
 * Mock mode is a data-source substitution — same semantic port (ADR-0002).
 */
export function resolveParameterModuleRegistryRepository(
  modeOrOptions: WiseEffRuntimeMode | ResolveOptions = {}
): ParameterModuleRegistryRepository {
  const options: ResolveOptions =
    typeof modeOrOptions === "string" ? { mode: modeOrOptions } : modeOrOptions;
  const mode = options.mode ?? wiseEffRuntimeMode;
  const createMock = options.createMock ?? createMockParameterModuleRegistryRepository;
  const createHttp = options.createHttp ?? createHttpParameterModuleRegistryRepository;

  if (mode === "mock") {
    return createMock();
  }
  return createHttp();
}
