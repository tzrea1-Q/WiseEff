import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import { createHttpDtsReloadRepository } from "@/infrastructure/http/dtsReloadClient";
import { wiseEffRuntimeMode, type WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { createMockDtsReloadRepository } from "@/infrastructure/mock/mockDtsReloadRepository";

type ResolveOptions = {
  mode?: WiseEffRuntimeMode;
  createMock?: typeof createMockDtsReloadRepository;
  createHttp?: typeof createHttpDtsReloadRepository;
};

/**
 * Pick mock vs HTTP DtsReloadRepository from runtime mode (ADR-0002: mock mode serves the
 * same semantic model through the same port). App/UI should inject the result; pages must
 * not construct clients directly.
 */
export function resolveDtsReloadRepository(
  modeOrOptions: WiseEffRuntimeMode | ResolveOptions = {}
): DtsReloadRepository {
  const options: ResolveOptions =
    typeof modeOrOptions === "string" ? { mode: modeOrOptions } : modeOrOptions;
  const mode = options.mode ?? wiseEffRuntimeMode;
  const createMock = options.createMock ?? createMockDtsReloadRepository;
  const createHttp = options.createHttp ?? createHttpDtsReloadRepository;

  if (mode === "mock") {
    return createMock();
  }
  return createHttp();
}
