export type ProjectDto = {
  id: string;
  name: string;
  code: string;
};

export type ProjectAdminSummaryDto = {
  id: string;
  name: string;
  code: string;
  /** Ops lifecycle: typically `initialized` | `maintenance`. */
  status: string;
  /** Init workflow status; distinct from ops `status` (migration 0091). */
  initializationStatus: string;
  moduleCount: number;
  parameterCount: number;
  openConflictCount: number;
  releasedBaselineCount: number;
  updatedAt: string;
};

export type ProjectAdminDetailDto = ProjectAdminSummaryDto & {
  modules: ProjectModuleDto[];
};

export type ProjectModuleDto = {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  parentId?: string | null;
  path?: string;
  depth?: number;
  parameterModuleId?: string | null;
};
