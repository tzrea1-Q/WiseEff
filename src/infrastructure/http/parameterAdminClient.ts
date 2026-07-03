import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";

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
    }
  };
}

export type ParameterAdminClient = ReturnType<typeof createParameterAdminClient>;
