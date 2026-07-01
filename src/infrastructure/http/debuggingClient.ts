import type { DebugConnectionProtocol } from "@/domain/debugging/types";
import type {
  DebuggingGateway,
  DebugSessionSnapshot,
  DetectTargetsInput,
  ReadNodeInput,
  ReloadParameterInput,
  RollbackSnapshotInput,
  WriteNodeInput
} from "@/application/ports/DebuggingGateway";
import { createApiClient, WiseEffApiError } from "./apiClient";
import {
  debugParameterFromDto,
  debugRuntimeNodeToDebugParameter,
  debugSnapshotFromDto,
  debugTargetFromDto,
  nodeOperationFromDto,
  nodeReadResultFromDto,
  nodeWriteResultFromDto,
  reloadTargetToDebugParameter,
  type DebugDeviceDto,
  type DebugParameterDto,
  type DebugRuntimeNodeDto,
  type DebugSnapshotDto,
  type DebugTargetDto,
  type NodeOperationDto,
  type ParameterReloadTargetDto
} from "./debuggingDtos";
import { createDefaultApiClient } from "./defaultApiClient";

type ApiClient = ReturnType<typeof createApiClient>;
type ItemsEnvelope<T> = { items: T[] };
type ItemEnvelope<T> = { item: T };
export type GetSessionResponseEnvelope = ItemEnvelope<DebugSessionSnapshot | null>;
type WriteNodeResponse = { operation: NodeOperationDto; snapshot?: DebugSnapshotDto };
type RollbackSnapshotResponse = { snapshot: DebugSnapshotDto; operations: NodeOperationDto[] };

function appendQuery(path: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function buildParametersPath(query?: { projectId?: string; protocol?: string }) {
  const params = new URLSearchParams();
  if (query?.projectId) params.set("projectId", query.projectId);
  if (query?.protocol) params.set("protocol", query.protocol);
  return appendQuery("/api/v1/debugging/parameters", params);
}

function sessionPath(sessionId: string) {
  return `/api/v1/debugging/sessions/${encodeURIComponent(sessionId)}`;
}

function snapshotRollbackPath(snapshotId: string) {
  return `/api/v1/debugging/snapshots/${encodeURIComponent(snapshotId)}/rollback`;
}

function buildReloadTargetsPath(query: { projectId: string; protocol?: string }) {
  const params = new URLSearchParams();
  params.set("projectId", query.projectId);
  if (query.protocol) params.set("protocol", query.protocol);
  return appendQuery("/api/v1/debugging/reload-targets", params);
}

function readNodeRequestBody(input: ReadNodeInput): ReadNodeInput {
  if (input.nodeId) {
    const { nodePath: _nodePath, parameterId: _parameterId, ...body } = input;
    return body;
  }
  if (!input.parameterId) {
    return input;
  }
  const { nodePath: _nodePath, ...body } = input;
  return body;
}

function buildRuntimeNodesPath(query: { projectId: string; protocol?: string }) {
  const params = new URLSearchParams();
  params.set("projectId", query.projectId);
  if (query.protocol) params.set("protocol", query.protocol);
  return appendQuery("/api/v1/debugging/nodes", params);
}

function writeNodeRequestBody(input: WriteNodeInput): WriteNodeInput {
  if (input.nodeId) {
    const { nodePath: _nodePath, parameterId: _parameterId, ...body } = input;
    return body;
  }
  if (!input.parameterId) {
    return input;
  }
  const { nodePath: _nodePath, ...body } = input;
  return body;
}

export function createHttpDebuggingGateway(apiClient: ApiClient = createDefaultApiClient()): DebuggingGateway {
  return {
    async listDevices() {
      const response = await apiClient.get<ItemsEnvelope<DebugDeviceDto>>("/api/v1/debugging/devices");
      return response.items;
    },
    async listRuntimeNodes(query: { projectId: string; protocol?: DebugConnectionProtocol }) {
      const response = await apiClient.get<ItemsEnvelope<DebugRuntimeNodeDto>>(buildRuntimeNodesPath(query));
      return response.items.map(debugRuntimeNodeToDebugParameter);
    },
    async listParameters(query) {
      const response = await apiClient.get<ItemsEnvelope<DebugParameterDto>>(buildParametersPath(query));
      return response.items.map(debugParameterFromDto);
    },
    async listReloadTargets(query) {
      const response = await apiClient.get<ItemsEnvelope<ParameterReloadTargetDto>>(buildReloadTargetsPath(query));
      return response.items.map(reloadTargetToDebugParameter);
    },
    async detectTargets(input?: DetectTargetsInput) {
      const response = await apiClient.post<ItemsEnvelope<DebugTargetDto>>("/api/v1/debugging/targets/detect", input ?? {});
      return response.items.map(debugTargetFromDto);
    },
    async createSession(input) {
      const response = await apiClient.post<ItemEnvelope<DebugSessionSnapshot>>("/api/v1/debugging/sessions", input);
      return response.item;
    },
    async getSession(sessionId) {
      try {
        const response = await apiClient.get<GetSessionResponseEnvelope>(sessionPath(sessionId));
        return response.item;
      } catch (error) {
        if (error instanceof WiseEffApiError && error.code === "NOT_FOUND") {
          return null;
        }
        throw error;
      }
    },
    async listSessionEvents(sessionId) {
      const response = await apiClient.get<ItemsEnvelope<NodeOperationDto>>(`${sessionPath(sessionId)}/events`);
      return response.items.map(nodeOperationFromDto);
    },
    async readNode(input: ReadNodeInput) {
      const response = await apiClient.post<{ operation: NodeOperationDto }>("/api/v1/debugging/nodes/read", readNodeRequestBody(input));
      return nodeReadResultFromDto(response.operation);
    },
    async writeNode(input: WriteNodeInput) {
      const response = await apiClient.post<WriteNodeResponse>("/api/v1/debugging/nodes/write", writeNodeRequestBody(input));
      return nodeWriteResultFromDto(response);
    },
    async reloadParameter(input: ReloadParameterInput) {
      const response = await apiClient.post<WriteNodeResponse>("/api/v1/debugging/parameters/reload", input);
      return nodeWriteResultFromDto(response);
    },
    async rollbackSnapshot(input: RollbackSnapshotInput) {
      const response = await apiClient.post<RollbackSnapshotResponse>(snapshotRollbackPath(input.snapshotId), {
        confirmationToken: input.confirmationToken
      });
      return {
        snapshot: debugSnapshotFromDto(response.snapshot),
        operations: response.operations.map(nodeOperationFromDto)
      };
    }
  };
}
