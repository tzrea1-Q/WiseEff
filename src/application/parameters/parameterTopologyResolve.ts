import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import { createHttpParameterTopologyRepository } from "@/infrastructure/http/parameterTopologyClient";
import { wiseEffRuntimeMode, type WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { createMockParameterTopologyRepository } from "@/infrastructure/mock/mockParameterTopologyRepository";

type ResolveOptions = {
  mode?: WiseEffRuntimeMode;
  createMock?: typeof createMockParameterTopologyRepository;
  createHttp?: typeof createHttpParameterTopologyRepository;
};

/**
 * Pick mock vs HTTP ParameterTopologyRepository from runtime mode.
 * Mock mode is a data-source substitution — same semantic port, fixture-backed adapter.
 */
export function resolveParameterTopologyRepository(
  modeOrOptions: WiseEffRuntimeMode | ResolveOptions = {}
): ParameterTopologyRepository {
  const options: ResolveOptions =
    typeof modeOrOptions === "string" ? { mode: modeOrOptions } : modeOrOptions;
  const mode = options.mode ?? wiseEffRuntimeMode;
  const createMock = options.createMock ?? createMockParameterTopologyRepository;
  const createHttp = options.createHttp ?? createHttpParameterTopologyRepository;

  if (mode === "mock") {
    return createMock();
  }
  return createHttp();
}
