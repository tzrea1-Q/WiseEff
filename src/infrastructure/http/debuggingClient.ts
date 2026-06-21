import type {
  DebuggingGateway,
  DebugSessionSnapshot,
  DetectTargetsInput,
  ReadNodeInput,
  RollbackSnapshotInput,
  WriteNodeInput
} from "@/application/ports/DebuggingGateway";
import { createApiClient, WiseEffApiError } from "./apiClient";
import {
  debugParameterFromDto,
  debugSnapshotFromDto,
  debugTargetFromDto,
  nodeOperationFromDto,
  nodeReadResultFromDto,
  nodeWriteResultFromDto,
  type DebugDeviceDto,
  type DebugParameterDto,
  type DebugSnapshotDto,
  type DebugTargetDto,
  type NodeOperationDto
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

function readNodeRequestBody(input: ReadNodeInput): ReadNodeInput {
  if (!input.parameterId) {
    return input;
  }
  const { nodePath: _nodePath, ...body } = input;
  return body;
}

function writeNodeRequestBody(input: WriteNodeInput): WriteNodeInput {
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
    async listParameters(query) {
      const response = await apiClient.get<ItemsEnvelope<DebugParameterDto>>(buildParametersPath(query));
      return response.items.map(debugParameterFromDto);
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
