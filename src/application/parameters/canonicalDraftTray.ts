import type { ParameterDraftDto } from "@/application/ports/ParameterRepository";

/**
 * Issue #849 B5: adapt the canonical pending-draft read into the workbench draft
 * tray's shape.
 *
 * The tray used to hydrate from `GET /api/v1/parameter-drafts/mine` (legacy
 * `parameter_drafts`) while drafts were *created* through the canonical
 * `POST /api/v2/projects/:id/parameter-bindings/:bindingId/drafts`, and `saveDraft`
 * is refused in `semantic` identity mode. A persisted canonical draft therefore never
 * reappeared in the tray and could not be removed through it.
 *
 * `parameterId` is absent on purpose rather than invented: the canonical model has no
 * parameter record, and the tray never reads this field for binding drafts (it keys
 * off `draftId` and `projectParameterBindingId`). `reason` and `updatedAt` do come
 * from the canonical list, so the tray keeps the author's reason across a reload.
 */
export type CanonicalPendingDraft = {
  readonly id: string;
  readonly bindingId: string;
  readonly definitionId: string;
  readonly effectiveRevisionId: string;
  readonly targetValue: string;
  readonly sourceFormat?: "dts" | "json";
  readonly sourceTarget?: { format: "json"; sourceText: string };
  readonly action?: "set" | "delete";
  readonly baseRevisionId: string;
  readonly sourcePinId?: string | null;
  readonly candidateId?: string | null;
  readonly reason: string;
  readonly updatedAt: string;
};

/**
 * What the tray needs to hydrate a draft. `parameterId` is optional here because the
 * canonical model has no parameter record; the legacy list always supplies it and the
 * tray never reads it for binding drafts, so it must not be invented for canonical ones.
 */
export type TrayHydrationDraft = Omit<ParameterDraftDto, "parameterId"> & {
  readonly parameterId?: string;
  readonly sourceFormat?: "dts" | "json";
  readonly sourceTarget?: { format: "json"; sourceText: string };
  readonly baseRevisionId?: string;
  readonly sourcePinId?: string | null;
  readonly candidateId?: string | null;
};

export function canonicalDraftsToTrayDrafts(
  projectId: string,
  drafts: readonly CanonicalPendingDraft[]
): TrayHydrationDraft[] {
  return drafts.map((draft) => ({
    id: draft.id,
    projectId,
    targetValue: draft.targetValue,
    reason: draft.reason,
    updatedAt: draft.updatedAt,
    action: draft.action ?? "set",
    projectParameterBindingId: draft.bindingId,
    candidateConfigRevisionId: draft.baseRevisionId,
    ...(draft.sourceFormat ? { sourceFormat: draft.sourceFormat } : {}),
    ...(draft.sourceTarget ? { sourceTarget: draft.sourceTarget } : {}),
    ...(draft.baseRevisionId ? { baseRevisionId: draft.baseRevisionId } : {}),
    ...(draft.sourcePinId !== undefined ? { sourcePinId: draft.sourcePinId } : {}),
    ...(draft.candidateId !== undefined ? { candidateId: draft.candidateId } : {})
  }));
}
