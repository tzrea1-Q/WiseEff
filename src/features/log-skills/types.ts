import type { z } from "zod";
import type { logSkillDtoSchema, logSkillRevisionDtoSchema, logSkillSampleDtoSchema, logSkillTemplateListResponseSchema } from "@wiseeff/dto-schemas";

export type SkillRevision = z.infer<typeof logSkillRevisionDtoSchema>;
export type SkillSpec = SkillRevision["spec"];
export type AnalysisSkill = z.infer<typeof logSkillDtoSchema>;
export type SkillSample = z.infer<typeof logSkillSampleDtoSchema>;
export type SkillTemplate = z.infer<typeof logSkillTemplateListResponseSchema>["items"][number];
export type CreateSkillInput = { name: string; description?: string; startingPoint: { templateId: string } | { copyFromSkillId: string } };

export interface SkillAuthoringRepository {
  listSkillTemplates(): Promise<SkillTemplate[]>;
  createLogSkill(input: CreateSkillInput): Promise<AnalysisSkill>;
  getSkillSample(id: string): Promise<SkillSample | null>;
  replaceSkillSample(id: string, file: File): Promise<void>;
  deleteSkillSample(id: string): Promise<void>;
}

export interface SkillWorkspaceRepository {
  getLogSkill(id: string): Promise<AnalysisSkill>;
  listSkillRevisions(id: string): Promise<SkillRevision[]>;
  saveSkillDraft(id: string, spec: SkillSpec, baseDraftRevisionId: string | null, basePublishedRevisionId: string): Promise<SkillRevision>;
  discardSkillDraft(id: string, draftRevisionId: string): Promise<void>;
  publishSkill(id: string, draftRevisionId: string): Promise<AnalysisSkill>;
  restoreSkillRevision(id: string, revisionId: string): Promise<AnalysisSkill>;
}
