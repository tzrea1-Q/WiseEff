import type { z } from "zod";
import type { logSkillDtoSchema, logSkillRevisionDtoSchema, logSkillSampleDtoSchema, logSkillTemplateListResponseSchema, parsePreviewResponseSchema, logSourceSnapshotDtoSchema } from "@wiseeff/dto-schemas";

export type SkillRevision = z.infer<typeof logSkillRevisionDtoSchema>;
export type SkillSpec = SkillRevision["spec"];
export type AnalysisSkill = z.infer<typeof logSkillDtoSchema>;
export type SkillSample = z.infer<typeof logSkillSampleDtoSchema>;
export type SkillTemplate = z.infer<typeof logSkillTemplateListResponseSchema>["items"][number];
export type AnalysisTraceStep = z.infer<typeof import("@wiseeff/dto-schemas").logTraceResponseSchema>["steps"][number];
export type SkillDryRun = z.infer<typeof import("@wiseeff/dto-schemas").logSkillDryRunResponseSchema>["run"];
export type SkillDryRunDetail = { run: SkillDryRun; steps: AnalysisTraceStep[] };
export type CreateSkillInput = { name: string; description?: string; startingPoint: { templateId: string } | { copyFromSkillId: string } };

export type AnalysisCaseExpectations = z.infer<typeof import("@wiseeff/dto-schemas").logAnalysisCaseExpectationsSchema>;
export type AnalysisCase = z.infer<typeof import("@wiseeff/dto-schemas").logAnalysisCaseSchema>;
export type AnalysisCaseRun = z.infer<typeof import("@wiseeff/dto-schemas").logAnalysisCaseRunSchema>;
export type AnalysisCaseList = z.infer<typeof import("@wiseeff/dto-schemas").logAnalysisCaseListResponseSchema>;
export type AnalysisCaseInput = { name: string; expectations: AnalysisCaseExpectations; files?: File[]; sourceRecordId?: string };
export type AnalysisCasePrefill = z.infer<typeof import("@wiseeff/dto-schemas").logAnalysisCasePrefillResponseSchema>;

export interface SkillAuthoringRepository {
  importSkillPackage?(file: File, status: "draft" | "published"): Promise<AnalysisSkill>;
  listSkillTemplates(): Promise<SkillTemplate[]>;
  createLogSkill(input: CreateSkillInput): Promise<AnalysisSkill>;
  getSkillSample(id: string): Promise<SkillSample | null>;
  replaceSkillSample(id: string, file: File): Promise<void>;
  deleteSkillSample(id: string): Promise<void>;
}
export type ParsePreview = z.infer<typeof parsePreviewResponseSchema>;
export type ParseTestRun = z.infer<typeof import("@wiseeff/dto-schemas").parseTestRunSchema>;
export type ParseTest = NonNullable<SkillSpec["parseTests"]>[number];
export type SignalPreview = z.infer<typeof import("@wiseeff/dto-schemas").signalPreviewResponseSchema>;
export type ExtractorPatternInput = z.infer<typeof import("@wiseeff/dto-schemas").extractorPreviewRequestSchema>;
export type ExtractorPatternPreview = z.infer<typeof import("@wiseeff/dto-schemas").extractorPreviewResponseSchema>;
export type FormatPreview = z.infer<typeof import("@wiseeff/dto-schemas").formatPreviewResponseSchema>;
export type SourceSnapshot = z.infer<typeof logSourceSnapshotDtoSchema>;
export type SourceExcerpt = z.infer<typeof import("@wiseeff/dto-schemas").logSourceExcerptDtoSchema>;
export type SourceStatementMatches = z.infer<typeof import("@wiseeff/dto-schemas").logSourceLocateResponseSchema>;

export interface SkillWorkspaceRepository {
  exportSkillPackage?(id: string, revision: "published" | "draft"): Promise<Blob>;
  runSkillParseTests?(id: string, spec: SkillSpec): Promise<ParseTestRun>;
  signalPreview?(id: string, input: { signalRules: NonNullable<SkillSpec["signalRules"]>; parsing?: SkillSpec["parsing"]; formatProfile?: SkillSpec["formatProfile"]; files?: SkillSpec["files"] }): Promise<SignalPreview>;
  generateExtractorPattern?(id: string, input: ExtractorPatternInput): Promise<ExtractorPatternPreview>;
  previewFormat?(id: string, input: { sampleText: string; formatProfile: unknown }): Promise<FormatPreview>;
  listAnalysisCases?(id: string): Promise<AnalysisCaseList>;
  createAnalysisCase?(id: string, input: AnalysisCaseInput): Promise<AnalysisCase>;
  updateAnalysisCase?(id: string, caseId: string, input: Pick<AnalysisCaseInput, "name" | "expectations">): Promise<AnalysisCase>;
  deleteAnalysisCase?(id: string, caseId: string): Promise<void>;
  startAnalysisCaseRun?(id: string, caseIds?: string[]): Promise<AnalysisCaseRun>;
  getAnalysisCaseRun?(id: string, runId: string): Promise<AnalysisCaseRun>;
  getAnalysisCaseTrace?(id: string, runId: string, caseId: string, revision: "draft" | "published"): Promise<AnalysisTraceStep[]>;
  getAnalysisCasePrefill?(logId: string): Promise<AnalysisCasePrefill>;
  importAnalysisCases?(id: string, file: File): Promise<void>;
  exportAnalysisCases?(id: string): Promise<Blob>;
  startSkillDryRun?(id: string): Promise<SkillDryRun>;
  getSkillDryRun?(id: string, runId: string): Promise<SkillDryRunDetail>;
  getSkillDryRunLines?(id: string, runId: string, file: string, startLine: number, endLine: number): Promise<import("@/application/ports/LogAnalysisRepository").LogLineRange>;
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
