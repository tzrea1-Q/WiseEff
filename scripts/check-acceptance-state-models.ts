import fc from "fast-check";
import { pathToFileURL } from "node:url";
import { permissionsForRoles } from "../server/modules/auth/policy";
import type { BackendPermission, BackendRoleId } from "../server/modules/auth/types";

const defaultSeed = 20260601;
const defaultNumRuns = 100;

const roleIds = [
  "guest",
  "hardware-user",
  "software-user",
  "hardware-committer",
  "software-committer",
  "admin"
] as const satisfies readonly BackendRoleId[];

export type AuditEventSummary = {
  id: string;
  action: string;
  actorRole: BackendRoleId;
  targetId: string;
};

export type StateModelFailure = {
  model: string;
  seed: number;
  path: string;
  message: string;
  steps: string[];
};

export type StateModelSummary = {
  name: string;
  status: "passed" | "failed";
  seed: number;
  numRuns: number;
  checkedRuns: number;
  failure?: StateModelFailure;
};

export type AcceptanceStateModelsResult = {
  status: "passed" | "failed";
  seed: number;
  numRuns: number;
  models: StateModelSummary[];
  failures: StateModelFailure[];
};

export type AcceptanceStateModelOptions = {
  seed?: number;
  numRuns?: number;
  modelOverrides?: Partial<
    Record<
      string,
      {
        invariant?: (state: unknown) => string | undefined;
      }
    >
  >;
};

type StateModelDefinition<State, Step> = {
  name: string;
  seedOffset: number;
  initial: () => State;
  steps: fc.Arbitrary<Step[]>;
  apply: (state: State, step: Step) => State;
  formatStep: (step: Step) => string;
  invariant: (state: State) => string | undefined;
};

export type ParameterModelStatus =
  | "draft"
  | "hardware_review"
  | "software_review"
  | "software_merge"
  | "rejected"
  | "merged";

export type ParameterModelStep =
  | { type: "submit"; actorRole: BackendRoleId }
  | { type: "advance"; actorRole: BackendRoleId }
  | { type: "reject"; actorRole: BackendRoleId }
  | { type: "merge"; actorRole: BackendRoleId };

export type ParameterModelState = {
  status: ParameterModelStatus;
  auditEvents: AuditEventSummary[];
  violations: string[];
  productionWriteCount: number;
  terminalTransitionCount: number;
};

export type LogTaskModelStatus = "empty" | "uploaded" | "analyzing" | "complete" | "failed" | "archived";

export type LogTaskModelStep =
  | { type: "upload"; actorRole: BackendRoleId }
  | { type: "startAnalysis"; actorRole: BackendRoleId }
  | { type: "complete"; actorRole: BackendRoleId }
  | { type: "fail"; actorRole: BackendRoleId }
  | { type: "feedback"; actorRole: BackendRoleId }
  | { type: "archive"; actorRole: BackendRoleId }
  | { type: "reanalyze"; actorRole: BackendRoleId };

export type LogTaskModelState = {
  status: LogTaskModelStatus;
  hasTerminalResult: boolean;
  feedbackCount: number;
  reanalysisCount: number;
  auditEvents: AuditEventSummary[];
  violations: string[];
  productionWriteCount: number;
};

export type DebuggingModelStep =
  | { type: "detect"; actorRole: BackendRoleId }
  | { type: "read"; actorRole: BackendRoleId }
  | { type: "write"; actorRole: BackendRoleId }
  | { type: "mismatch"; actorRole: BackendRoleId }
  | { type: "rollback"; actorRole: BackendRoleId };

export type DebuggingModelState = {
  targetDetected: boolean;
  hasRead: boolean;
  hasValidSnapshot: boolean;
  mismatchReported: boolean;
  auditEvents: AuditEventSummary[];
  violations: string[];
  productionWriteCount: number;
};

export type PermissionRoute =
  | "/parameters"
  | "/parameter-review"
  | "/parameter-admin"
  | "/logs"
  | "/log-admin"
  | "/debugging"
  | "/node-debugging"
  | "/debugging-admin"
  | "/user-permissions";

export type PermissionModelStep =
  | { type: "setRole"; roleId: BackendRoleId }
  | { type: "forceApiPermission"; permission: BackendPermission; allowed: boolean }
  | { type: "forceVisibleRoute"; route: PermissionRoute; visible: boolean };

export type PermissionModelState = {
  roleId: BackendRoleId;
  apiPermissions: BackendPermission[];
  visibleRoutes: PermissionRoute[];
  violations: string[];
};

const permissionRoutes: Record<PermissionRoute, BackendPermission> = {
  "/parameters": "parameter:view",
  "/parameter-review": "parameter:review",
  "/parameter-admin": "admin:access",
  "/logs": "logs:view",
  "/log-admin": "admin:access",
  "/debugging": "debugging:view",
  "/node-debugging": "debugging:read",
  "/debugging-admin": "debugging:admin",
  "/user-permissions": "users:manage"
};

const terminalParameterStatuses = new Set<ParameterModelStatus>(["merged", "rejected"]);

export function initialParameterModelState(): ParameterModelState {
  return {
    status: "draft",
    auditEvents: [],
    violations: [],
    productionWriteCount: 0,
    terminalTransitionCount: 0
  };
}

export function applyParameterModelStep(state: ParameterModelState, step: ParameterModelStep): ParameterModelState {
  if (terminalParameterStatuses.has(state.status)) {
    return block(state, "parameter terminal states cannot be transitioned again");
  }

  if (step.type === "submit") {
    if (state.status !== "draft") {
      return block(state, "parameter submit requires a draft request");
    }
    if (!roleHas(step.actorRole, "parameter:edit")) {
      return block(state, "parameter submit requires parameter:edit");
    }
    return parameterWrite({ ...state, status: "hardware_review" }, "submit", step.actorRole);
  }

  if (step.type === "advance") {
    if (!roleHas(step.actorRole, "parameter:review")) {
      return block(state, "parameter advance requires parameter:review");
    }
    if (state.status === "hardware_review" && step.actorRole !== "software-committer") {
      return parameterWrite({ ...state, status: "software_review" }, "advance", step.actorRole);
    }
    if (state.status === "software_review" && step.actorRole !== "hardware-committer") {
      return parameterWrite({ ...state, status: "software_merge" }, "advance", step.actorRole);
    }
    return block(state, "parameter advance requires the matching review state");
  }

  if (step.type === "reject") {
    if (state.status === "draft") {
      return block(state, "parameter reject requires a submitted request");
    }
    if (!roleHas(step.actorRole, "parameter:review")) {
      return block(state, "parameter reject requires parameter:review");
    }
    return parameterWrite(
      { ...state, status: "rejected", terminalTransitionCount: state.terminalTransitionCount + 1 },
      "reject",
      step.actorRole
    );
  }

  if (state.status !== "software_merge") {
    return block(state, "parameter merge requires software_merge state");
  }
  if (!["software-user", "software-committer", "admin"].includes(step.actorRole)) {
    return block(state, "parameter merge requires software-side merge role");
  }
  if (!roleHas(step.actorRole, "parameter:edit")) {
    return block(state, "parameter merge requires parameter:edit");
  }
  return parameterWrite(
    { ...state, status: "merged", terminalTransitionCount: state.terminalTransitionCount + 1 },
    "merge",
    step.actorRole
  );
}

export function initialLogTaskModelState(): LogTaskModelState {
  return {
    status: "empty",
    hasTerminalResult: false,
    feedbackCount: 0,
    reanalysisCount: 0,
    auditEvents: [],
    violations: [],
    productionWriteCount: 0
  };
}

export function applyLogTaskModelStep(state: LogTaskModelState, step: LogTaskModelStep): LogTaskModelState {
  if (step.type === "upload") {
    if (!roleHas(step.actorRole, "logs:upload")) {
      return block(state, "log upload requires logs:upload");
    }
    return logWrite({ ...state, status: "uploaded", hasTerminalResult: false }, "upload", step.actorRole);
  }

  if (step.type === "startAnalysis") {
    if (!roleHas(step.actorRole, "logs:analyze")) {
      return block(state, "log analysis requires logs:analyze");
    }
    if (!["uploaded", "complete", "failed", "archived"].includes(state.status)) {
      return block(state, "log analysis requires an uploaded or terminal task");
    }
    return logWrite({ ...state, status: "analyzing" }, "startAnalysis", step.actorRole);
  }

  if (step.type === "complete" || step.type === "fail") {
    if (state.status !== "analyzing") {
      return block(state, "log terminal result requires analyzing state");
    }
    const status = step.type === "complete" ? "complete" : "failed";
    return logWrite({ ...state, status, hasTerminalResult: true }, step.type, step.actorRole);
  }

  if (step.type === "feedback") {
    if (!roleHas(step.actorRole, "logs:feedback")) {
      return block(state, "log feedback requires logs:feedback");
    }
    if (!state.hasTerminalResult) {
      return block(state, "log feedback requires a terminal result");
    }
    return logWrite({ ...state, feedbackCount: state.feedbackCount + 1 }, "feedback", step.actorRole);
  }

  if (step.type === "archive") {
    if (!roleHas(step.actorRole, "logs:archive")) {
      return block(state, "log archive requires logs:archive");
    }
    if (!state.hasTerminalResult) {
      return block(state, "log archive requires a terminal result");
    }
    if (state.status === "archived") {
      return block(state, "log archive requires an unarchived task");
    }
    return logWrite({ ...state, status: "archived" }, "archive", step.actorRole);
  }

  if (!roleHas(step.actorRole, "logs:analyze")) {
    return block(state, "log reanalysis requires logs:analyze");
  }
  if (!state.hasTerminalResult) {
    return block(state, "log reanalysis requires a terminal result");
  }
  return logWrite(
    { ...state, status: "analyzing", reanalysisCount: state.reanalysisCount + 1 },
    "reanalyze",
    step.actorRole
  );
}

export function initialDebuggingModelState(): DebuggingModelState {
  return {
    targetDetected: false,
    hasRead: false,
    hasValidSnapshot: false,
    mismatchReported: false,
    auditEvents: [],
    violations: [],
    productionWriteCount: 0
  };
}

export function applyDebuggingModelStep(state: DebuggingModelState, step: DebuggingModelStep): DebuggingModelState {
  if (step.type === "detect") {
    if (!roleHas(step.actorRole, "debugging:view")) {
      return block(state, "debugging detection requires debugging:view");
    }
    return debuggingAudit({ ...state, targetDetected: true }, "detect", step.actorRole);
  }

  if (step.type === "read") {
    if (!roleHas(step.actorRole, "debugging:read")) {
      return block(state, "debugging read requires debugging:read");
    }
    if (!state.targetDetected) {
      return block(state, "debugging read requires target detection");
    }
    return debuggingAudit({ ...state, hasRead: true }, "read", step.actorRole);
  }

  if (step.type === "write") {
    if (!roleHas(step.actorRole, "debugging:write")) {
      return block(state, "debugging write requires debugging:write");
    }
    if (!state.hasRead) {
      return block(state, "debugging write requires a prior read");
    }
    return debuggingWrite({ ...state, hasValidSnapshot: true }, "write", step.actorRole);
  }

  if (step.type === "mismatch") {
    if (!state.hasValidSnapshot) {
      return block(state, "readback mismatch requires a write snapshot");
    }
    return debuggingAudit({ ...state, mismatchReported: true }, "mismatch", step.actorRole);
  }

  if (!roleHas(step.actorRole, "debugging:rollback")) {
    return block(state, "rollback requires debugging:rollback");
  }
  if (!state.hasValidSnapshot) {
    return block(state, "rollback requires a valid snapshot");
  }
  return debuggingWrite({ ...state, hasValidSnapshot: false }, "rollback", step.actorRole);
}

export function initialPermissionModelState(): PermissionModelState {
  const roleId = "hardware-user";
  const apiPermissions = permissionsForRoles([roleId]);
  return {
    roleId,
    apiPermissions,
    visibleRoutes: routesVisibleForPermissions(apiPermissions),
    violations: []
  };
}

export function applyPermissionModelStep(state: PermissionModelState, step: PermissionModelStep): PermissionModelState {
  if (step.type === "setRole") {
    const apiPermissions = permissionsForRoles([step.roleId]);
    return {
      roleId: step.roleId,
      apiPermissions,
      visibleRoutes: routesVisibleForPermissions(apiPermissions),
      violations: state.violations
    };
  }

  if (step.type === "forceApiPermission") {
    const apiPermissionSet = new Set(state.apiPermissions);
    if (step.allowed) {
      apiPermissionSet.add(step.permission);
    } else {
      apiPermissionSet.delete(step.permission);
    }
    const apiPermissions = Array.from(apiPermissionSet);
    return {
      ...state,
      apiPermissions,
      visibleRoutes: state.visibleRoutes.filter((route) => apiPermissions.includes(permissionRoutes[route]))
    };
  }

  if (!step.visible) {
    return { ...state, visibleRoutes: state.visibleRoutes.filter((route) => route !== step.route) };
  }

  if (!state.apiPermissions.includes(permissionRoutes[step.route])) {
    return block(state, "UI route visibility cannot exceed API eligibility");
  }

  return {
    ...state,
    visibleRoutes: Array.from(new Set([...state.visibleRoutes, step.route]))
  };
}

const roleArbitrary = fc.constantFrom(...roleIds);
const backendPermissionArbitrary = fc.constantFrom<BackendPermission>(
  "parameter:view",
  "parameter:edit",
  "debugging:use",
  "debugging:view",
  "debugging:read",
  "debugging:write",
  "debugging:rollback",
  "debugging:admin",
  "logs:view",
  "logs:upload",
  "logs:analyze",
  "logs:archive",
  "logs:feedback",
  "parameter:review",
  "admin:access",
  "users:manage"
);
const routeArbitrary = fc.constantFrom<PermissionRoute>(
  "/parameters",
  "/parameter-review",
  "/parameter-admin",
  "/logs",
  "/log-admin",
  "/debugging",
  "/node-debugging",
  "/debugging-admin",
  "/user-permissions"
);

const parameterStepArbitrary: fc.Arbitrary<ParameterModelStep> = fc.oneof(
  roleArbitrary.map((actorRole): ParameterModelStep => ({ type: "submit", actorRole })),
  roleArbitrary.map((actorRole): ParameterModelStep => ({ type: "advance", actorRole })),
  roleArbitrary.map((actorRole): ParameterModelStep => ({ type: "reject", actorRole })),
  roleArbitrary.map((actorRole): ParameterModelStep => ({ type: "merge", actorRole }))
);

const logTaskStepArbitrary: fc.Arbitrary<LogTaskModelStep> = fc.oneof(
  roleArbitrary.map((actorRole): LogTaskModelStep => ({ type: "upload", actorRole })),
  roleArbitrary.map((actorRole): LogTaskModelStep => ({ type: "startAnalysis", actorRole })),
  roleArbitrary.map((actorRole): LogTaskModelStep => ({ type: "complete", actorRole })),
  roleArbitrary.map((actorRole): LogTaskModelStep => ({ type: "fail", actorRole })),
  roleArbitrary.map((actorRole): LogTaskModelStep => ({ type: "feedback", actorRole })),
  roleArbitrary.map((actorRole): LogTaskModelStep => ({ type: "archive", actorRole })),
  roleArbitrary.map((actorRole): LogTaskModelStep => ({ type: "reanalyze", actorRole }))
);

const debuggingStepArbitrary: fc.Arbitrary<DebuggingModelStep> = fc.oneof(
  roleArbitrary.map((actorRole): DebuggingModelStep => ({ type: "detect", actorRole })),
  roleArbitrary.map((actorRole): DebuggingModelStep => ({ type: "read", actorRole })),
  roleArbitrary.map((actorRole): DebuggingModelStep => ({ type: "write", actorRole })),
  roleArbitrary.map((actorRole): DebuggingModelStep => ({ type: "mismatch", actorRole })),
  roleArbitrary.map((actorRole): DebuggingModelStep => ({ type: "rollback", actorRole }))
);

const permissionStepArbitrary: fc.Arbitrary<PermissionModelStep> = fc.oneof(
  roleArbitrary.map((roleId): PermissionModelStep => ({ type: "setRole", roleId })),
  fc.record({
    type: fc.constant("forceApiPermission"),
    permission: backendPermissionArbitrary,
    allowed: fc.boolean()
  }),
  fc.record({
    type: fc.constant("forceVisibleRoute"),
    route: routeArbitrary,
    visible: fc.boolean()
  })
);

const parameterStateModelDefinition: StateModelDefinition<ParameterModelState, ParameterModelStep> = {
  name: "parameter-approval",
  seedOffset: 0,
  initial: initialParameterModelState,
  steps: fc.array(parameterStepArbitrary, { minLength: 1, maxLength: 32 }),
  apply: applyParameterModelStep,
  formatStep: formatParameterStep,
  invariant: assertParameterInvariant
};

const logTaskStateModelDefinition: StateModelDefinition<LogTaskModelState, LogTaskModelStep> = {
  name: "log-analysis-task",
  seedOffset: 1,
  initial: initialLogTaskModelState,
  steps: fc.array(logTaskStepArbitrary, { minLength: 1, maxLength: 32 }),
  apply: applyLogTaskModelStep,
  formatStep: formatLogTaskStep,
  invariant: assertLogTaskInvariant
};

const debuggingStateModelDefinition: StateModelDefinition<DebuggingModelState, DebuggingModelStep> = {
  name: "debugging-session",
  seedOffset: 2,
  initial: initialDebuggingModelState,
  steps: fc.array(debuggingStepArbitrary, { minLength: 1, maxLength: 32 }),
  apply: applyDebuggingModelStep,
  formatStep: formatDebuggingStep,
  invariant: assertDebuggingInvariant
};

const permissionStateModelDefinition: StateModelDefinition<PermissionModelState, PermissionModelStep> = {
  name: "permission-visibility",
  seedOffset: 3,
  initial: initialPermissionModelState,
  steps: fc.array(permissionStepArbitrary, { minLength: 1, maxLength: 32 }),
  apply: applyPermissionModelStep,
  formatStep: formatPermissionStep,
  invariant: assertPermissionInvariant
};

export const acceptanceStateModelDefinitions = [
  parameterStateModelDefinition,
  logTaskStateModelDefinition,
  debuggingStateModelDefinition,
  permissionStateModelDefinition
] as const;

export function evaluateAcceptanceStateModels(
  options: AcceptanceStateModelOptions = {}
): AcceptanceStateModelsResult {
  const seed = options.seed ?? defaultSeed;
  const numRuns = options.numRuns ?? defaultNumRuns;
  const models = [
    evaluateStateModelDefinition(
      withModelOverride(parameterStateModelDefinition, options.modelOverrides?.[parameterStateModelDefinition.name]),
      seed + parameterStateModelDefinition.seedOffset,
      numRuns
    ),
    evaluateStateModelDefinition(
      withModelOverride(logTaskStateModelDefinition, options.modelOverrides?.[logTaskStateModelDefinition.name]),
      seed + logTaskStateModelDefinition.seedOffset,
      numRuns
    ),
    evaluateStateModelDefinition(
      withModelOverride(debuggingStateModelDefinition, options.modelOverrides?.[debuggingStateModelDefinition.name]),
      seed + debuggingStateModelDefinition.seedOffset,
      numRuns
    ),
    evaluateStateModelDefinition(
      withModelOverride(permissionStateModelDefinition, options.modelOverrides?.[permissionStateModelDefinition.name]),
      seed + permissionStateModelDefinition.seedOffset,
      numRuns
    )
  ];
  const failures = models.flatMap((model) => (model.failure ? [model.failure] : []));

  return {
    status: failures.length === 0 ? "passed" : "failed",
    seed,
    numRuns,
    models,
    failures
  };
}

function withModelOverride<State, Step>(
  definition: StateModelDefinition<State, Step>,
  override?: { invariant?: (state: unknown) => string | undefined }
): StateModelDefinition<State, Step> {
  if (!override?.invariant) {
    return definition;
  }

  return {
    ...definition,
    invariant: (state) => override.invariant?.(state) ?? definition.invariant(state)
  };
}

export function runAcceptanceStateModels(options: AcceptanceStateModelOptions = {}) {
  const result = evaluateAcceptanceStateModels(options);
  console.log(JSON.stringify(result, null, 2));

  if (result.failures.length) {
    console.error(result.failures.map(formatStateModelFailure).join("\n\n"));
  }

  return result;
}

export function formatStateModelFailure(failure: StateModelFailure) {
  return [
    `[${failure.model}] ${failure.message}`,
    `seed=${failure.seed}`,
    `path=${failure.path || "<none>"}`,
    "reproduction:",
    ...failure.steps.map((step, index) => `${index + 1}. ${step}`)
  ].join("\n");
}

function evaluateStateModelDefinition<State, Step>(
  definition: StateModelDefinition<State, Step>,
  seed: number,
  numRuns: number
): StateModelSummary {
  const property = fc.property(definition.steps, (steps) => {
    const finalState = steps.reduce(definition.apply, definition.initial());
    const violation = definition.invariant(finalState);
    if (violation) {
      throw new Error(violation);
    }
  });
  const details = fc.check(property, { seed, numRuns });

  if (!details.failed) {
    return {
      name: definition.name,
      status: "passed",
      seed,
      numRuns,
      checkedRuns: details.numRuns
    };
  }

  const counterexampleSteps = details.counterexample?.[0] as Step[] | undefined;
  const failure: StateModelFailure = {
    model: definition.name,
    seed,
    path: details.counterexamplePath ?? "",
    message:
      details.errorInstance instanceof Error
        ? details.errorInstance.message
        : String(details.errorInstance ?? "state model failed"),
    steps: counterexampleSteps?.map(definition.formatStep) ?? []
  };

  return {
    name: definition.name,
    status: "failed",
    seed,
    numRuns,
    checkedRuns: details.numRuns,
    failure
  };
}

function parameterWrite(state: ParameterModelState, action: string, actorRole: BackendRoleId): ParameterModelState {
  return {
    ...state,
    productionWriteCount: state.productionWriteCount + 1,
    auditEvents: [...state.auditEvents, auditEvent(action, actorRole, "parameter-request")]
  };
}

function logWrite(state: LogTaskModelState, action: string, actorRole: BackendRoleId): LogTaskModelState {
  return {
    ...state,
    productionWriteCount: state.productionWriteCount + 1,
    auditEvents: [...state.auditEvents, auditEvent(action, actorRole, "log-task")]
  };
}

function debuggingAudit(state: DebuggingModelState, action: string, actorRole: BackendRoleId): DebuggingModelState {
  return {
    ...state,
    auditEvents: [...state.auditEvents, auditEvent(action, actorRole, "debugging-session")]
  };
}

function debuggingWrite(state: DebuggingModelState, action: string, actorRole: BackendRoleId): DebuggingModelState {
  return {
    ...debuggingAudit(state, action, actorRole),
    productionWriteCount: state.productionWriteCount + 1
  };
}

function auditEvent(action: string, actorRole: BackendRoleId, targetId: string): AuditEventSummary {
  return {
    id: `${targetId}-${action}`,
    action,
    actorRole,
    targetId
  };
}

function block<State extends { violations: string[] }>(state: State, message: string): State {
  return {
    ...state,
    violations: [...state.violations, message]
  };
}

function roleHas(roleId: BackendRoleId, permission: BackendPermission) {
  return permissionsForRoles([roleId]).includes(permission);
}

function routesVisibleForPermissions(apiPermissions: BackendPermission[]) {
  return (Object.keys(permissionRoutes) as PermissionRoute[]).filter((route) =>
    apiPermissions.includes(permissionRoutes[route])
  );
}

function assertParameterInvariant(state: ParameterModelState) {
  if (state.productionWriteCount !== state.auditEvents.length) {
    return "every parameter production write must have audit";
  }
  if (state.terminalTransitionCount > 1) {
    return "parameter terminal states cannot be transitioned again";
  }
  return undefined;
}

function assertLogTaskInvariant(state: LogTaskModelState) {
  if (state.productionWriteCount !== state.auditEvents.length) {
    return "every log production write must have audit";
  }
  if (state.status === "archived" && !state.hasTerminalResult) {
    return "log archive requires a terminal result";
  }
  return undefined;
}

function assertDebuggingInvariant(state: DebuggingModelState) {
  const productionAuditCount = state.auditEvents.filter((event) => event.action === "write" || event.action === "rollback").length;
  if (state.productionWriteCount !== productionAuditCount) {
    return "every debugging production write must have audit";
  }
  return undefined;
}

function assertPermissionInvariant(state: PermissionModelState) {
  const routeWithoutApi = state.visibleRoutes.find((route) => !state.apiPermissions.includes(permissionRoutes[route]));
  if (routeWithoutApi) {
    return "UI route visibility cannot exceed API eligibility";
  }
  return undefined;
}

function formatParameterStep(step: ParameterModelStep) {
  return `${step.type}(${step.actorRole})`;
}

function formatLogTaskStep(step: LogTaskModelStep) {
  return `${step.type}(${step.actorRole})`;
}

function formatDebuggingStep(step: DebuggingModelStep) {
  return `${step.type}(${step.actorRole})`;
}

function formatPermissionStep(step: PermissionModelStep) {
  if (step.type === "setRole") {
    return `setRole(${step.roleId})`;
  }
  if (step.type === "forceApiPermission") {
    return `forceApiPermission(${step.permission}, ${step.allowed})`;
  }
  return `forceVisibleRoute(${step.route}, ${step.visible})`;
}

function parseCliOptions(argv: string[]): AcceptanceStateModelOptions {
  const options: AcceptanceStateModelOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--seed") {
      options.seed = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--num-runs") {
      options.numRuns = Number(argv[index + 1]);
      index += 1;
    }
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runAcceptanceStateModels(parseCliOptions(process.argv.slice(2)));
  process.exit(result.status === "passed" ? 0 : 1);
}
