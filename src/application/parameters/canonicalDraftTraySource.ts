import { createParameterCatalogClient } from "@/infrastructure/http/parameterCatalogClient";
import { readLocalAuthToken } from "@/infrastructure/http/authClient";
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
export const createCanonicalDraftTraySource = (
  client = createParameterCatalogClient({
    baseUrl: resolveWiseEffApiBaseUrl(),
    getAuthorization: async () => {
      const localToken = readLocalAuthToken();
      return localToken ? `Bearer ${localToken}` : wiseEffApiAuthorization;
    }
  })
) => ({
  listDrafts: async (projectId: string): Promise<readonly TrayHydrationDraft[]> => {
    const listed = await client.listProjectValueDrafts(projectId);
    return canonicalDraftsToTrayDrafts(projectId, listed.items ?? []);
  },
  deleteDraft: async (projectId: string, draftId: string): Promise<void> => {
    await client.deleteProjectValueDraft(projectId, draftId);
  }
});
