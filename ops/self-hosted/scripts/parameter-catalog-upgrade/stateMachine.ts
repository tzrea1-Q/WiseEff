export const CONTROLLER_STATES = Object.freeze([
  "idle",
  "planned",
  "executing",
  "cutover-completed",
  "verification-prepared",
  "verification-ran",
  "recovery-required",
  "failed",
] as const);

export type ControllerState = (typeof CONTROLLER_STATES)[number];

export const LEGAL_ACTIONS = Object.freeze([
  "plan",
  "execute",
  "inspect",
  "recover",
  "prepareVerification",
  "runVerification",
  "resume",
] as const);

export type LegalAction = (typeof LEGAL_ACTIONS)[number];

export const FORBIDDEN_ACTIONS = Object.freeze([
  "selectGates",
  "migrateViaApi",
  "guessUnknownCommit",
] as const);

export type ForbiddenAction = (typeof FORBIDDEN_ACTIONS)[number];

export const CONTROLLER_REFUSAL_CODES = Object.freeze([
  "PCAT-UPG-ILLEGAL-ACTION",
  "PCAT-UPG-GATE-SELECTION-FORBIDDEN",
  "PCAT-UPG-API-MIGRATE-FORBIDDEN",
  "PCAT-UPG-UNKNOWN-OUTCOME",
] as const);

export type ControllerRefusalCode = (typeof CONTROLLER_REFUSAL_CODES)[number];

export type ControllerRefusal = {
  readonly code: ControllerRefusalCode;
  readonly detail: string;
};

export type ControllerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ControllerRefusal };

export type TransitionOptions = {
  readonly executeCompleted?: boolean;
};

const LEGAL_BY_STATE: Readonly<Record<ControllerState, readonly LegalAction[]>> = Object.freeze({
  idle: Object.freeze(["plan", "inspect"] as const),
  planned: Object.freeze(["plan", "execute", "inspect", "resume"] as const),
  executing: Object.freeze(["execute", "inspect", "recover", "resume"] as const),
  "cutover-completed": Object.freeze([
    "inspect",
    "prepareVerification",
    "recover",
  ] as const),
  "verification-prepared": Object.freeze([
    "prepareVerification",
    "runVerification",
    "inspect",
  ] as const),
  "verification-ran": Object.freeze([
    "runVerification",
    "inspect",
    "prepareVerification",
  ] as const),
  "recovery-required": Object.freeze(["inspect", "recover"] as const),
  failed: Object.freeze(["inspect", "recover"] as const),
});

const isLegalActionName = (action: string): action is LegalAction =>
  (LEGAL_ACTIONS as readonly string[]).includes(action);

const isControllerState = (value: string): value is ControllerState =>
  (CONTROLLER_STATES as readonly string[]).includes(value);

export const failClosed = (
  code: ControllerRefusalCode,
  detail: string,
): ControllerResult<never> => ({
  ok: false,
  error: { code, detail },
});

export const isLegalAction = (state: ControllerState, action: string): boolean => {
  if (!isLegalActionName(action)) {
    return false;
  }
  return LEGAL_BY_STATE[state].includes(action);
};

const isUnknownOutcomeGuess = (state: ControllerState, action: string): boolean =>
  (action === "execute" || action === "resume") &&
  (state === "recovery-required" || state === "failed");

export const resolveAction = (
  state: ControllerState,
  action: string,
): ControllerResult<LegalAction> => {
  if (isUnknownOutcomeGuess(state, action)) {
    return failClosed(
      "PCAT-UPG-UNKNOWN-OUTCOME",
      "Unknown commit outcome cannot be guessed; inspect or recover the same journal",
    );
  }
  if (action === "resume") {
    if (state === "planned" || state === "executing") {
      return { ok: true, value: "execute" };
    }
    return failClosed(
      "PCAT-UPG-ILLEGAL-ACTION",
      `resume is not legal in state ${state}`,
    );
  }
  if (!isLegalActionName(action)) {
    return failClosed("PCAT-UPG-ILLEGAL-ACTION", `action ${action} is not a legal controller action`);
  }
  return { ok: true, value: action };
};

export const nextActionFor = (
  state: ControllerState,
  last?: "crash" | "ok",
): LegalAction | "none" => {
  switch (state) {
    case "idle":
      return "plan";
    case "planned":
      return "execute";
    case "executing":
      return last === "crash" ? "inspect" : "execute";
    case "cutover-completed":
      return "prepareVerification";
    case "verification-prepared":
      return "runVerification";
    case "verification-ran":
    case "recovery-required":
    case "failed":
      return "none";
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
};

export const transition = (
  state: ControllerState,
  action: string,
  options: TransitionOptions = {},
): ControllerResult<ControllerState> => {
  if (isUnknownOutcomeGuess(state, action)) {
    return failClosed(
      "PCAT-UPG-UNKNOWN-OUTCOME",
      "Unknown commit outcome cannot be guessed; inspect or recover the same journal",
    );
  }
  if (!isLegalAction(state, action)) {
    return failClosed(
      "PCAT-UPG-ILLEGAL-ACTION",
      `action ${action} is not legal in state ${state}`,
    );
  }
  if (action === "inspect" || action === "resume") {
    return { ok: true, value: state };
  }
  if (action === "plan") {
    return { ok: true, value: "planned" };
  }
  if (action === "execute") {
    if (options.executeCompleted === true) {
      return { ok: true, value: "cutover-completed" };
    }
    return { ok: true, value: "executing" };
  }
  if (action === "recover") {
    return { ok: true, value: "recovery-required" };
  }
  if (action === "prepareVerification") {
    return { ok: true, value: "verification-prepared" };
  }
  if (action === "runVerification") {
    return { ok: true, value: "verification-ran" };
  }
  return failClosed("PCAT-UPG-ILLEGAL-ACTION", `action ${action} is not legal in state ${state}`);
};

export const parseControllerState = (value: string): ControllerResult<ControllerState> => {
  if (!isControllerState(value)) {
    return failClosed("PCAT-UPG-ILLEGAL-ACTION", `unknown controller state ${value}`);
  }
  return { ok: true, value };
};
