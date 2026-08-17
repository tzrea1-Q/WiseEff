import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";

import App from "@/App";
import type { AppRuntime } from "@/app/appRuntime";
import type { PrototypeState } from "@/domain/prototype/types";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";

import { createTestAppPorts } from "./createTestAppPorts";

export type RenderAppOptions = Omit<RenderOptions, "wrapper"> & {
  path?: string;
  initialAppState?: PrototypeState;
  runtimeMode?: WiseEffRuntimeMode;
  /** Per-port overrides. Unspecified ports stay on mock adapters (API mode) or App-owned mocks (mock mode). */
  ports?: Partial<AppRuntime>;
};

/**
 * Map an assembled `AppRuntime` onto the App component's port props.
 * Undefined fields are omitted so App's `createAppRuntime` can fill them.
 */
export function toAppPortProps(ports?: Partial<AppRuntime>): Partial<{
  authClient: AppRuntime["authClient"];
  parameterRepository: AppRuntime["parameterRepository"];
  parameterTopologyRepository: AppRuntime["parameterTopologyRepository"];
  parameterInitializationRepository: AppRuntime["parameterInitializationRepository"];
  logAnalysisRepository: AppRuntime["logAnalysisRepository"];
  productFeedbackRepository: AppRuntime["productFeedbackRepository"];
  knowledgeRepository: AppRuntime["knowledgeRepository"];
  dtsReloadRepository: AppRuntime["dtsReloadRepository"];
  debuggingGateway: AppRuntime["debuggingGateway"];
  debuggingAdminClient: AppRuntime["debuggingAdminClient"];
  userGovernanceActions: AppRuntime["userGovernanceActions"];
  listParameterConfigSets: AppRuntime["listParameterConfigSets"];
}> {
  if (!ports) {
    return {};
  }

  const props: ReturnType<typeof toAppPortProps> = {};
  if (ports.authClient !== undefined) props.authClient = ports.authClient;
  if (ports.parameterRepository !== undefined) props.parameterRepository = ports.parameterRepository;
  if (ports.parameterTopologyRepository !== undefined) {
    props.parameterTopologyRepository = ports.parameterTopologyRepository;
  }
  if (ports.parameterInitializationRepository !== undefined) {
    props.parameterInitializationRepository = ports.parameterInitializationRepository;
  }
  if (ports.logAnalysisRepository !== undefined) props.logAnalysisRepository = ports.logAnalysisRepository;
  if (ports.productFeedbackRepository !== undefined) {
    props.productFeedbackRepository = ports.productFeedbackRepository;
  }
  if (ports.knowledgeRepository !== undefined) props.knowledgeRepository = ports.knowledgeRepository;
  if (ports.dtsReloadRepository !== undefined) props.dtsReloadRepository = ports.dtsReloadRepository;
  if (ports.debuggingGateway !== undefined) props.debuggingGateway = ports.debuggingGateway;
  if (ports.debuggingAdminClient !== undefined) props.debuggingAdminClient = ports.debuggingAdminClient;
  if (ports.userGovernanceActions !== undefined) props.userGovernanceActions = ports.userGovernanceActions;
  if (ports.listParameterConfigSets !== undefined) props.listParameterConfigSets = ports.listParameterConfigSets;
  return props;
}

/**
 * Shared App render entry (TD-073).
 *
 * Mock mode without `ports` lets App own the mock-runtime lifecycle (reducer
 * and adapters stay in sync). API mode always assembles mock adapters first
 * so unspecified ports do not become HTTP clients; pass per-port overrides
 * for the seams a test actually cares about.
 */
export function renderApp(options: RenderAppOptions = {}) {
  const { path, initialAppState, runtimeMode = "mock", ports: portOverrides, ...renderOptions } = options;

  if (path !== undefined) {
    window.history.replaceState(null, "", path);
  }

  const ports =
    runtimeMode === "api"
      ? createTestAppPorts({ initialState: initialAppState, overrides: portOverrides })
      : portOverrides;

  const view = render(
    (
      <App initialAppState={initialAppState} runtimeMode={runtimeMode} {...toAppPortProps(ports)} />
    ) as ReactElement,
    renderOptions
  );

  return { ...view, ports };
}
