import type {
  DebugDeviceSnapshot,
  DebuggingGateway,
  DebugSessionSnapshot,
  DebugSnapshotSummary,
  DeviceTarget,
  NodeOperationSnapshot,
  NodeReadResult,
  NodeWriteResult,
  ReadNodeInput,
  RollbackSnapshotInput,
  WriteNodeInput
} from "@/application/ports/DebuggingGateway";
import type { DebugConnectionProtocol, DebugDeviceTransport } from "@/domain/debugging/types";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import type { AppAction } from "@/App";
import type { DebugParameter, Device, PrototypeState } from "@/mockData";

type DebuggingGatewayReadResult = NodeReadResult & { operation?: NodeOperationSnapshot };
type DebuggingGatewayWriteResult = NodeWriteResult & {
  operation?: NodeOperationSnapshot;
  snapshot?: DebugSnapshotSummary;
};

export const debuggingRuntimeFailureNotification = "调试操作未完成，请稍后重试。";

export type HydrateDebugRuntimeAction = {
  type: "HYDRATE_DEBUG_RUNTIME";
  devices: Device[];
  debugParameters: DebugParameter[];
};

export type SetDebugActiveSessionAction = {
  type: "SET_DEBUG_ACTIVE_SESSION";
  session: DebugSessionSnapshot | null;
  target?: DeviceTarget;
};

export type UpsertDebugNodeOperationAction = {
  type: "UPSERT_DEBUG_NODE_OPERATION";
  operation: NodeOperationSnapshot;
};

export type UpsertDebugSnapshotAction = {
  type: "UPSERT_DEBUG_SNAPSHOT";
  snapshot: DebugSnapshotSummary;
};

export type DebuggingRuntimeDispatchAction =
  | HydrateDebugRuntimeAction
  | SetDebugActiveSessionAction
  | UpsertDebugNodeOperationAction
  | UpsertDebugSnapshotAction
  | Extract<AppAction, { type: "CONNECT_DEVICE" } | { type: "PUSH_DEBUG_VALUES" } | { type: "ROLLBACK_LAST_SNAPSHOT" } | { type: "ADD_NOTIFICATION" }>;

export type DebuggingRuntimeActions = {
  refresh(query?: { projectId?: string; protocol?: DebugConnectionProtocol }): Promise<void>;
  detectAndStartSession(projectId: string, options?: { protocol?: DebugConnectionProtocol }): Promise<{ session: DebugSessionSnapshot; target: DeviceTarget }>;
  readNode(input: ReadNodeInput): Promise<NodeReadResult>;
  writeNode(input: WriteNodeInput & { risk?: "Low" | "Medium" | "High" }): Promise<NodeWriteResult>;
  pushValues(parameterIds: string[]): Promise<void>;
  rollbackSnapshot(input: RollbackSnapshotInput): Promise<void>;
  rollbackLastSnapshot(): Promise<void>;
  connectDevice(deviceId: string): Promise<void>;
};

type DebuggingRuntimeOptions = {
  mode: WiseEffRuntimeMode;
  gateway?: DebuggingGateway;
  dispatch: (action: DebuggingRuntimeDispatchAction) => void;
  getState: () => PrototypeState;
};

export type DebuggingRuntimeNotifiedFailure = Error & { alreadyNotified: true; cause: unknown };

function requireGateway(gateway?: DebuggingGateway): DebuggingGateway {
  if (!gateway) {
    throw new Error("Debugging gateway is required in api runtime mode.");
  }
  return gateway;
}

function resolveDebuggingRuntimeCause(error: unknown): unknown {
  if (error instanceof Error && error.cause) {
    return error.cause;
  }
  return error;
}

export function formatDebuggingRuntimeError(error: unknown): string {
  const cause = resolveDebuggingRuntimeCause(error);

  if (cause instanceof WiseEffApiError) {
    if (cause.code === "UNAUTHENTICATED") {
      return "请先登录后再执行调试操作。";
    }
    if (cause.code === "FORBIDDEN") {
      return "当前账号无权执行此调试操作。";
    }
    if (cause.message.trim()) {
      return cause.message;
    }
  }

  if (error instanceof Error && error.message.trim() && error.message !== debuggingRuntimeFailureNotification) {
    return error.message;
  }

  if (cause instanceof Error && cause.message.trim()) {
    return cause.message;
  }

  return debuggingRuntimeFailureNotification;
}

function notifyFailure(dispatch: DebuggingRuntimeOptions["dispatch"], cause: unknown): DebuggingRuntimeNotifiedFailure {
  const message = formatDebuggingRuntimeError(cause);
  dispatch({ type: "ADD_NOTIFICATION", message });
  return Object.assign(new Error(message, { cause }), { alreadyNotified: true as const, cause });
}

function deviceStatusFromApi(status: DebugDeviceSnapshot["status"]): Device["status"] {
  if (status === "online") {
    return "已连接";
  }
  if (status === "offline") {
    return "未连接";
  }
  return "连接失败";
}

function deviceFromApi(device: DebugDeviceSnapshot): Device {
  return {
    id: device.id,
    name: device.name,
    projectId: device.projectId,
    transport: device.transport,
    firmware: device.firmware,
    status: deviceStatusFromApi(device.status),
    lastSeen: device.lastSeenAt ?? "unknown"
  };
}

function transportMatchesProtocol(transport: DebugDeviceTransport | undefined, protocol: DebugConnectionProtocol) {
  return transport === protocol || transport === "multi";
}

function findProtocolDebugDevice(
  devices: Device[],
  projectId: string,
  protocol: DebugConnectionProtocol = "hdc"
): Device | undefined {
  const projectDevices = devices.filter((item) => item.projectId === projectId);
  return projectDevices.find((item) => transportMatchesProtocol(item.transport, protocol));
}

function resolveProjectDebugDeviceFromDevices(
  devices: Device[],
  projectId: string,
  protocol: DebugConnectionProtocol = "hdc"
): Device {
  const projectDevices = devices.filter((item) => item.projectId === projectId);
  const device =
    findProtocolDebugDevice(devices, projectId, protocol) ??
    (protocol === "adb" ? projectDevices.find((item) => item.id.startsWith("adb-")) : undefined) ??
    projectDevices[0] ??
    devices[0];
  if (!device) {
    throw new Error("No debug device is registered for this project.");
  }
  return device;
}

function resolveProjectDebugDevice(
  state: PrototypeState,
  projectId: string,
  protocol: DebugConnectionProtocol = "hdc"
): Device {
  return resolveProjectDebugDeviceFromDevices(state.devices, projectId, protocol);
}

function dispatchOperation(dispatch: DebuggingRuntimeOptions["dispatch"], operation?: NodeOperationSnapshot) {
  if (operation) {
    dispatch({
      type: "UPSERT_DEBUG_NODE_OPERATION",
      operation: preserveNodeOperationMetadata(operation)
    });
  }
}

function preserveNodeOperationMetadata(operation: NodeOperationSnapshot): NodeOperationSnapshot {
  return {
    ...operation,
    valueKind: operation.valueKind,
    valueFormat: operation.valueFormat,
    normalizationMode: operation.normalizationMode,
    requestedValueDigest: operation.requestedValueDigest,
    previousValueDigest: operation.previousValueDigest,
    readbackValueDigest: operation.readbackValueDigest,
    valuePreview: operation.valuePreview
  };
}

function dispatchSnapshot(dispatch: DebuggingRuntimeOptions["dispatch"], snapshot?: DebugSnapshotSummary) {
  if (snapshot) {
    dispatch({ type: "UPSERT_DEBUG_SNAPSHOT", snapshot });
  }
}

async function runApi<T>(dispatch: DebuggingRuntimeOptions["dispatch"], action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw notifyFailure(dispatch, error);
  }
}

function isWritablePendingDebugParameter(
  parameter: DebugParameter,
  state: PrototypeState
): parameter is DebugParameter & { nodePath: string; targetValue: string } {
  return Boolean(state.debuggingActiveSessionId)
    && Boolean(parameter.nodePath)
    && Boolean(parameter.targetValue)
    && (parameter.accessMode === "WO" || parameter.accessMode === "RW")
    && parameter.status === "待下发";
}

export function createDebuggingRuntimeActions({
  mode,
  gateway,
  dispatch,
  getState
}: DebuggingRuntimeOptions): DebuggingRuntimeActions {
  const refresh = async (query?: { projectId?: string; protocol?: DebugConnectionProtocol }) => {
    if (mode !== "api") {
      return;
    }

    await runApi(dispatch, async () => {
      const api = requireGateway(gateway);
      const parameterQuery = { ...query, protocol: query?.protocol ?? "hdc" as const };
      const [devices, debugParameters] = await Promise.all([
        api.listDevices?.() ?? Promise.resolve([]),
        api.listParameters?.(parameterQuery) ?? Promise.resolve([])
      ]);

      dispatch({
        type: "HYDRATE_DEBUG_RUNTIME",
        devices: devices.map(deviceFromApi),
        debugParameters
      });
    });
  };

  return {
    refresh,
    async detectAndStartSession(projectId, options) {
      const protocol = options?.protocol ?? "hdc";
      if (mode !== "api") {
        const device = resolveProjectDebugDevice(getState(), projectId, protocol);
        dispatch({ type: "CONNECT_DEVICE", deviceId: device.id });
        const target = { id: device.id, deviceId: device.id, protocol, label: device.name };
        return {
          target,
          session: {
            id: `mock-session-${device.id}`,
            projectId,
            deviceId: device.id,
            targetId: target.id,
            protocol,
            status: "active",
            startedAt: new Date().toISOString(),
            endedAt: null
          }
        };
      }

      return runApi(dispatch, async () => {
        const api = requireGateway(gateway);
        let state = getState();
        let device = findProtocolDebugDevice(state.devices, projectId, protocol);
        if (!device && api.listDevices) {
          const apiDevices = (await api.listDevices()).map(deviceFromApi);
          if (apiDevices.length > 0) {
            state = { ...state, devices: apiDevices };
            device = resolveProjectDebugDevice(state, projectId, protocol);
          }
        }
        device ??= resolveProjectDebugDevice(state, projectId, protocol);
        const [target] = await api.detectTargets({ projectId, protocol, deviceId: device.id });
        if (!target) {
          throw new Error("No debug target detected.");
        }
        if (!api.createSession) {
          throw new Error("Debug session creation is not supported by this gateway.");
        }
        const session = await api.createSession({
          projectId,
          deviceId: target.deviceId ?? device.id,
          targetId: target.id,
          protocol
        });
        dispatch({ type: "SET_DEBUG_ACTIVE_SESSION", session, target });
        return { session, target };
      });
    },
    async readNode(input) {
      if (mode !== "api") {
        return { ok: true, value: getState().debugParameters.find((parameter) => parameter.nodePath === input.nodePath)?.currentValue };
      }

      return runApi(dispatch, async () => {
        const result = (await requireGateway(gateway).readNode(input)) as DebuggingGatewayReadResult;
        dispatchOperation(dispatch, result.operation);
        return result;
      });
    },
    async writeNode(input) {
      if (mode !== "api") {
        dispatch({ type: "PUSH_DEBUG_VALUES", parameterIds: input.parameterId ? [input.parameterId] : [] });
        return { ok: true, value: input.value, verified: true };
      }

      return runApi(dispatch, async () => {
        const { risk, ...writeInput } = input;
        const request: WriteNodeInput =
          risk === "High" && !writeInput.approvalId && !writeInput.confirmationToken
            ? { ...writeInput, confirmationToken: "confirm-high-risk-write" }
            : writeInput;
        const result = (await requireGateway(gateway).writeNode(request)) as DebuggingGatewayWriteResult;
        dispatchOperation(dispatch, result.operation);
        dispatchSnapshot(dispatch, result.snapshot);
        return result;
      });
    },
    async pushValues(parameterIds) {
      if (mode !== "api") {
        dispatch({ type: "PUSH_DEBUG_VALUES", parameterIds });
        return;
      }

      await runApi(dispatch, async () => {
        const state = getState();
        const sessionId = state.debuggingActiveSessionId;
        if (!sessionId) {
          return;
        }
        const parameterById = new Map(state.debugParameters.map((parameter) => [parameter.id, parameter]));
        const parameters = parameterIds.flatMap((parameterId) => {
          const parameter = parameterById.get(parameterId);
          return parameter && isWritablePendingDebugParameter(parameter, state) ? [parameter] : [];
        });
        for (const parameter of parameters) {
          const result = (await requireGateway(gateway).writeNode({
            sessionId,
            parameterId: parameter.id,
            nodePath: parameter.nodePath,
            value: parameter.targetValue,
            readBack: true,
            ...(parameter.risk === "High" ? { confirmationToken: "confirm-high-risk-write" } : {})
          })) as DebuggingGatewayWriteResult;
          dispatchOperation(dispatch, result.operation);
          dispatchSnapshot(dispatch, result.snapshot);
        }
      });
    },
    async rollbackSnapshot(input) {
      if (mode !== "api") {
        dispatch({ type: "ROLLBACK_LAST_SNAPSHOT" });
        return;
      }

      await runApi(dispatch, async () => {
        const api = requireGateway(gateway);
        if (!api.rollbackSnapshot) {
          throw new Error("Snapshot rollback is not supported by this gateway.");
        }
        const result = await api.rollbackSnapshot(input);
        dispatchSnapshot(dispatch, result.snapshot);
        for (const operation of result.operations) {
          dispatchOperation(dispatch, operation);
        }
        if (api.listSessionEvents) {
          const operations = await api.listSessionEvents(result.snapshot.sessionId);
          for (const operation of operations) {
            dispatchOperation(dispatch, operation);
          }
        }
      });
    },
    async rollbackLastSnapshot() {
      dispatch({ type: "ROLLBACK_LAST_SNAPSHOT" });
    },
    async connectDevice(deviceId) {
      dispatch({ type: "CONNECT_DEVICE", deviceId });
    }
  };
}
