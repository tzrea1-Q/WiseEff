import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";

export type ParameterModuleDto = FlatModuleNode;

export type ProjectAdminSummaryDto = {
  id: string;
  name: string;
  code: string;
  status: string;
  moduleCount: number;
  parameterCount: number;
  updatedAt: string;
};

export type ProjectAdminModuleDto = {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
};

export type ProjectAdminDetailDto = ProjectAdminSummaryDto & {
  modules: ProjectAdminModuleDto[];
};

export type CreateProjectAdminInput = {
  name: string;
  code: string;
  id?: string;
};

export type UpdateProjectAdminInput = {
  name?: string;
  code?: string;
  status?: string;
};

export type CreateParameterModuleAdminInput = {
  name: string;
  parentId?: string | null;
  description?: string;
  scope?: string;
  sortOrder?: number;
};

export type UpdateParameterModuleAdminInput = {
  name?: string;
  description?: string;
  scope?: string;
  sortOrder?: number;
};

export type MoveParameterModuleAdminInput = {
  parentId: string | null;
};

type ItemsEnvelope<T> = { items: T[] };
type ItemEnvelope<T> = { item: T };

type ApiClient = ReturnType<typeof createApiClient>;

export function createParameterAdminClient(client: ApiClient = createDefaultApiClient()) {
  return {
    async listProjects() {
      const response = await client.get<ItemsEnvelope<ProjectAdminSummaryDto>>("/api/v1/parameters/admin/projects");
      return response.items;
    },
    async getProject(projectId: string) {
      const response = await client.get<ItemEnvelope<ProjectAdminDetailDto>>(`/api/v1/parameters/admin/projects/${encodeURIComponent(projectId)}`);
      return response.item;
    },
    async createProject(input: CreateProjectAdminInput) {
      const response = await client.post<ItemEnvelope<ProjectAdminSummaryDto>>("/api/v1/parameters/admin/projects", input);
      return response.item;
    },
    async updateProject(projectId: string, input: UpdateProjectAdminInput) {
      const response = await client.patch<ItemEnvelope<ProjectAdminDetailDto>>(
        `/api/v1/parameters/admin/projects/${encodeURIComponent(projectId)}`,
        input
      );
      return response.item;
    },
    async deleteProject(projectId: string) {
      await client.delete<{ ok: true }>(`/api/v1/parameters/admin/projects/${encodeURIComponent(projectId)}`);
    },
    async listModules() {
      const response = await client.get<ItemsEnvelope<ParameterModuleDto>>("/api/v1/parameter-modules");
      return response.items;
    },
    async createModule(input: CreateParameterModuleAdminInput) {
      const response = await client.post<ItemEnvelope<ParameterModuleDto>>("/api/v1/parameter-modules", input);
      return response.item;
    },
    async updateModule(moduleId: string, input: UpdateParameterModuleAdminInput) {
      const response = await client.patch<ItemEnvelope<ParameterModuleDto>>(
        `/api/v1/parameter-modules/${encodeURIComponent(moduleId)}`,
        input
      );
      return response.item;
    },
    async moveModule(moduleId: string, input: MoveParameterModuleAdminInput) {
      const response = await client.post<ItemEnvelope<ParameterModuleDto>>(
        `/api/v1/parameter-modules/${encodeURIComponent(moduleId)}/move`,
        input
      );
      return response.item;
    },
    async deleteModule(moduleId: string) {
      await client.delete<null>(`/api/v1/parameter-modules/${encodeURIComponent(moduleId)}`);
    }
  };
}

export type ParameterAdminClient = ReturnType<typeof createParameterAdminClient>;
