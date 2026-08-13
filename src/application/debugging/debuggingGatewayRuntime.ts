import type { DebuggingGateway } from "@/application/ports/DebuggingGateway";
import type { DebugParameter } from "@/domain/debugging/types";
import { createHttpDebuggingGateway } from "@/infrastructure/http/debuggingClient";
import { wiseEffRuntimeMode, type WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { createMockDebuggingGateway } from "@/infrastructure/mock/mockDebuggingGateway";

type ResolveOptions = {
  mode?: WiseEffRuntimeMode;
  /**
   * Live debug-parameter catalog accessor for the mock device story. The app shell
   * passes the prototype-state accessor; when omitted the mock serves the bundled
   * catalog.
   */
  getDebugParameters?: () => DebugParameter[];
  createMock?: typeof createMockDebuggingGateway;
  createHttp?: typeof createHttpDebuggingGateway;
};

/**
 * Pick mock vs HTTP DebuggingGateway from runtime mode (ADR-0002: mock mode serves the
 * same node-debugging model through the same port). Runtime-mode knowledge lives here —
 * the app/UI injects the result; pages must not construct clients (or raw fetches)
 * themselves.
 */
export function resolveDebuggingGateway(
  modeOrOptions: WiseEffRuntimeMode | ResolveOptions = {}
): DebuggingGateway {
  const options: ResolveOptions =
    typeof modeOrOptions === "string" ? { mode: modeOrOptions } : modeOrOptions;
  const mode = options.mode ?? wiseEffRuntimeMode;
  const createMock = options.createMock ?? createMockDebuggingGateway;
  const createHttp = options.createHttp ?? createHttpDebuggingGateway;

  if (mode === "mock") {
    return createMock(options.getDebugParameters ? { getDebugParameters: options.getDebugParameters } : {});
  }
  return createHttp();
}
