import type { ModuleMatchKind } from "./types";

export type CreateModuleMappingBody = {
  moduleId: string;
  matchKind: ModuleMatchKind;
  matchValue: string;
  priority?: number;
};
