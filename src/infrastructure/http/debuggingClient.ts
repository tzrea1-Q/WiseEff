import { z } from "zod";

import type { DebugConnectionProtocol } from "@/domain/debugging/types";
import type {
  DebuggingGateway,
  DebugSessionSnapshot,
  DebugSnapshotSummary,
  DetectTargetsInput,
  NodeOperationSnapshot,
  NodeWriteResult,
  ReadNodeInput,
  RollbackSnapshotInput,
  WriteNodeInput
} from "@/application/ports/DebuggingGateway";
import { createApiClient, WiseEffApiError } from "./apiClient";
import { parseContractDto } from "./parseContractDto";
import {
  debugDeviceListResponseSchema,
  debugNodeListResponseSchema,
  debugNodeOperationResponseSchema,
  debugParameterListResponseSchema,
  debugRollbackResponseSchema,
  debugSessionResponseSchema,
  debugTargetListResponseSchema
} from "@wiseeff/dto-schemas";
import {
  debugParameterFromDto,
  debugRuntimeNodeToDebugParameter,
  debugSnapshotFromDto,
  debugTargetFromDto,
  nodeOperationFromDto,
  nodeReadResultFromDto,
  nodeWriteResultFromDto,
  type DebugDeviceDto,
  type DebugParameterDto,
  type DebugRuntimeNodeDto,
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

const canonicalPinFields = {
  bindingId: z.string().optional(),
  effectiveRevisionId: z.string().optional(),
  currentValueId: z.string().optional(),
  protectedReferenceKind: z.enum(["canonical-pin", "typed-block"]).optional(),
  protectedReferenceReason: z.string().optional()
};

const pinnedParameterSchema = debugParameterListResponseSchema.shape.items.element.extend(canonicalPinFields);
const pinnedRuntimeNodeSchema = debugNodeListResponseSchema.shape.items.element.extend(canonicalPinFields);
const pinnedOperationSchema = debugNodeOperationResponseSchema.shape.operation.extend(canonicalPinFields);
const pinnedParameterListSchema = z.object({ items: z.array(pinnedParameterSchema) });
const pinnedRuntimeNodeListSchema = z.object({ items: z.array(pinnedRuntimeNodeSchema) });
const pinnedSessionEventListSchema = z.object({ items: z.array(pinnedOperationSchema) });
const pinnedNodeOperationResponseSchema = debugNodeOperationResponseSchema.extend({
  operation: pinnedOperationSchema
});
const pinnedRollbackResponseSchema = debugRollbackResponseSchema.extend({
  operations: z.array(pinnedOperationSchema)
});

function appendQuery(path: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function buildParametersPath(query?: { protocol?: string }) {
  const params = new URLSearchParams();
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

function buildRuntimeNodesPath(query?: { protocol?: string }) {
  const params = new URLSearchParams();
  if (query?.protocol) params.set("protocol", query.protocol);
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

function detectTargetsRequestBody(input?: DetectTargetsInput): DetectTargetsInput {
  if (!input) {
    return {};
  }
  const bridgeId = input.bridgeId?.trim();
  if (!bridgeId) {
    const { bridgeId: _bridgeId, ...body } = input;
    return body;
  }
  return { ...input, bridgeId };
}

export function createHttpDebuggingGateway(apiClient: ApiClient = createDefaultApiClient()): DebuggingGateway {
  return {
    async listDevices() {
      const response = parseContractDto(
        debugDeviceListResponseSchema,
        await apiClient.get<ItemsEnvelope<DebugDeviceDto>>("/api/v1/debugging/devices"),
        "DebugDeviceListResponse"
      );
      return response.items;
    },
    async listRuntimeNodes(query?: { protocol?: DebugConnectionProtocol }) {
      const response = parseContractDto(
        pinnedRuntimeNodeListSchema,
        await apiClient.get<ItemsEnvelope<DebugRuntimeNodeDto>>(buildRuntimeNodesPath(query)),
        "DebugNodeListResponse"
      );
      return response.items.map(debugRuntimeNodeToDebugParameter);
    },
    async listParameters(query) {
      const response = parseContractDto(
        pinnedParameterListSchema,
        await apiClient.get<ItemsEnvelope<DebugParameterDto>>(buildParametersPath(query)),
        "DebugParameterListResponse"
      );
      return response.items.map(debugParameterFromDto);
    },
    async detectTargets(input?: DetectTargetsInput) {
      const response = parseContractDto(
        debugTargetListResponseSchema,
        await apiClient.post<ItemsEnvelope<DebugTargetDto>>(
          "/api/v1/debugging/targets/detect",
          detectTargetsRequestBody(input)
        ),
        "DebugTargetListResponse"
      );
      return response.items.map(debugTargetFromDto);
    },
    async createSession(input) {
      const response = parseContractDto(
        debugSessionResponseSchema,
        await apiClient.post<ItemEnvelope<DebugSessionSnapshot>>("/api/v1/debugging/sessions", input),
        "DebugSessionResponse"
      );
      if (response.item === null) {
        throw new WiseEffApiError("INTERNAL_ERROR", "Debug session create returned no session.", { reason: "contract-drift" }, "");
      }
      return response.item;
    },
    async getSession(sessionId) {
      try {
        const response = parseContractDto(
          debugSessionResponseSchema,
          await apiClient.get<GetSessionResponseEnvelope>(sessionPath(sessionId)),
          "DebugSessionResponse"
        );
        return response.item;
      } catch (error) {
        if (error instanceof WiseEffApiError && error.code === "NOT_FOUND") {
          return null;
        }
        throw error;
      }
    },
    async listSessionEvents(sessionId) {
      const response = parseContractDto(
        pinnedSessionEventListSchema,
        await apiClient.get<ItemsEnvelope<NodeOperationDto>>(`${sessionPath(sessionId)}/events`),
        "DebugSessionEventListResponse"
      );
      return response.items.map(nodeOperationFromDto);
    },
    async readNode(input: ReadNodeInput) {
      const response = parseContractDto(
        pinnedNodeOperationResponseSchema,
        await apiClient.post<{ operation: NodeOperationDto }>("/api/v1/debugging/nodes/read", readNodeRequestBody(input)),
        "DebugNodeOperationResponse"
      );
      return nodeReadResultFromDto(response.operation);
    },
    async writeNode(input: WriteNodeInput) {
      const response = parseContractDto(
        pinnedNodeOperationResponseSchema,
        await apiClient.post<WriteNodeResponse>("/api/v1/debugging/nodes/write", writeNodeRequestBody(input)),
        "DebugNodeOperationResponse"
      );
      // Expose the operation (and snapshot when the backend sends one) so the
      // debugging runtime can record history and hydrate the rollback snapshot.
      const result: NodeWriteResult & { operation: NodeOperationSnapshot; snapshot?: DebugSnapshotSummary } = {
        ...nodeWriteResultFromDto(response),
        operation: nodeOperationFromDto(response.operation),
        ...(response.snapshot ? { snapshot: debugSnapshotFromDto(response.snapshot) } : {})
      };
      return result;
    },
    async rollbackSnapshot(input: RollbackSnapshotInput) {
      const response = parseContractDto(
        pinnedRollbackResponseSchema,
        await apiClient.post<RollbackSnapshotResponse>(snapshotRollbackPath(input.snapshotId), {
          confirmationToken: input.confirmationToken
        }),
        "DebugRollbackResponse"
      );
      return {
        snapshot: debugSnapshotFromDto(response.snapshot),
        operations: response.operations.map(nodeOperationFromDto)
      };
    }
  };
}
