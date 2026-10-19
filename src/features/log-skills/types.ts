import type { z } from "zod";
import type { logSkillDtoSchema, logSkillRevisionDtoSchema } from "@wiseeff/dto-schemas";

export type SkillRevision = z.infer<typeof logSkillRevisionDtoSchema>;
export type SkillSpec = SkillRevision["spec"];
export type AnalysisSkill = z.infer<typeof logSkillDtoSchema>;

export interface SkillWorkspaceRepository {
  getLogSkill(id: string): Promise<AnalysisSkill>;
  listSkillRevisions(id: string): Promise<SkillRevision[]>;
  saveSkillDraft(id: string, spec: SkillSpec, baseDraftRevisionId: string | null, basePublishedRevisionId: string): Promise<SkillRevision>;
  discardSkillDraft(id: string, draftRevisionId: string): Promise<void>;
  publishSkill(id: string, draftRevisionId: string): Promise<AnalysisSkill>;
  restoreSkillRevision(id: string, revisionId: string): Promise<AnalysisSkill>;
}
