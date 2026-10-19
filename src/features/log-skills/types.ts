import type { z } from "zod";
import type { logSkillDtoSchema, logSkillRevisionDtoSchema, logSkillSampleDtoSchema, logSkillTemplateListResponseSchema, parsePreviewResponseSchema, logSourceSnapshotDtoSchema } from "@wiseeff/dto-schemas";

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
export type ParsePreview = z.infer<typeof parsePreviewResponseSchema>;
export type SourceSnapshot = z.infer<typeof logSourceSnapshotDtoSchema>;
export type SourceExcerpt = z.infer<typeof import("@wiseeff/dto-schemas").logSourceExcerptDtoSchema>;
export type SourceStatementMatches = z.infer<typeof import("@wiseeff/dto-schemas").logSourceLocateResponseSchema>;

export interface SkillWorkspaceRepository {
  parsePreview?(id: string, input: { parsing: unknown; sampleText: string; fileName?: string }): Promise<ParsePreview>;
  getSkillSampleText?(id: string): Promise<{ text: string; fileName?: string } | null>;
  getLogSkill(id: string): Promise<AnalysisSkill>;
  listSkillRevisions(id: string): Promise<SkillRevision[]>;
  saveSkillDraft(id: string, spec: SkillSpec, baseDraftRevisionId: string | null, basePublishedRevisionId: string): Promise<SkillRevision>;
  discardSkillDraft(id: string, draftRevisionId: string): Promise<void>;
  publishSkill(id: string, draftRevisionId: string): Promise<AnalysisSkill>;
  restoreSkillRevision(id: string, revisionId: string): Promise<AnalysisSkill>;
  listSourceSnapshots(id: string): Promise<SourceSnapshot[]>;
  uploadSourceSnapshot(id: string, input: { versionLabel: string; file: File }): Promise<SourceSnapshot>;
  setDefaultSourceSnapshot(id: string, snapshotId: string): Promise<AnalysisSkill>;
  archiveSourceSnapshot(id: string, snapshotId: string): Promise<SourceSnapshot>;
  locateSourceStatement(id: string, snapshotId: string, line: string): Promise<SourceStatementMatches>;
}
