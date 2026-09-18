import { createParameterCatalogClient } from "@/infrastructure/http/parameterCatalogClient";
import { readLocalAuthToken } from "@/infrastructure/http/authClient";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import {
  resolveWiseEffApiBaseUrl,
  wiseEffApiAuthorization
} from "@/infrastructure/http/runtimeMode";
import {
  canonicalDraftsToTrayDrafts,
  type TrayHydrationDraft
} from "./canonicalDraftTray";

/**
 * Issue #849 B5: the canonical pending-draft source for the workbench draft tray.
 *
 * The tray used to hydrate from the legacy `GET /api/v1/parameter-drafts/mine` while
 * drafts were created through the canonical binding-draft route and `saveDraft` is
 * refused in `semantic` identity mode, so a persisted canonical draft never reappeared
 * and could not be removed through the tray. Both directions now address the canonical
 * owner.
 */
type CanonicalDraftTrayClient = {
  listProjectValueDrafts: NonNullable<ParameterCatalogRepository["listProjectValueDrafts"]>;
  deleteProjectValueDraft: NonNullable<ParameterCatalogRepository["deleteProjectValueDraft"]>;
};

export const createCanonicalDraftTraySource = (
  client?: CanonicalDraftTrayClient | ParameterCatalogRepository
) => {
  const fallback = createParameterCatalogClient({
    baseUrl: resolveWiseEffApiBaseUrl(),
    getAuthorization: async () => {
      const localToken = readLocalAuthToken();
      return localToken ? `Bearer ${localToken}` : wiseEffApiAuthorization;
    }
  });
  const listProjectValueDrafts = client?.listProjectValueDrafts ?? fallback.listProjectValueDrafts;
  const deleteProjectValueDraft = client?.deleteProjectValueDraft ?? fallback.deleteProjectValueDraft;
  if (!listProjectValueDrafts || !deleteProjectValueDraft) {
    throw new Error("canonical draft repository is not configured");
  }
  return {
  listDrafts: async (projectId: string): Promise<readonly TrayHydrationDraft[]> => {
    const listed = await listProjectValueDrafts.call(client ?? fallback, projectId);
    return canonicalDraftsToTrayDrafts(
      projectId,
      (listed.items ?? []).map((draft) => ({
        ...draft,
        sourceFormat: draft.sourceFormat === "json" || draft.sourceFormat === "dts" ? draft.sourceFormat : undefined
      }))
    );
  },
  deleteDraft: async (projectId: string, draftId: string): Promise<void> => {
    await deleteProjectValueDraft.call(client ?? fallback, projectId, draftId);
  }
  };
};
