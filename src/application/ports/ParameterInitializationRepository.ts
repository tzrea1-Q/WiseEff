import type {
  InitializationDraftDto,
  InitializationReviewDto,
  PreviewInitializationSnapshotInput,
  ProjectInitializationStateDto,
  SemanticInitializationSnapshotItem,
  UpsertInitializationDraftInput
} from "@/domain/parameters/initializationTypes";

export type {
  InitializationDraftDto,
  InitializationReviewDto,
  PreviewInitializationSnapshotInput,
  ProjectInitializationStateDto,
  SemanticInitializationSnapshotItem,
  UpsertInitializationDraftInput
};

export interface ParameterInitializationRepository {
  getInitialization(projectId: string): Promise<ProjectInitializationStateDto>;
  upsertDraft(input: UpsertInitializationDraftInput): Promise<InitializationDraftDto>;
  previewSnapshot(input: PreviewInitializationSnapshotInput): Promise<SemanticInitializationSnapshotItem[]>;
  submit(projectId: string): Promise<InitializationReviewDto>;
  listPendingReviews(): Promise<InitializationReviewDto[]>;
  approve(reviewId: string): Promise<InitializationReviewDto>;
  reject(reviewId: string, reason: string): Promise<InitializationReviewDto>;
}
