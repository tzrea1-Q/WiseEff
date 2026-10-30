import { Upload } from "lucide-react";
import { useContext, useMemo, useState, type Dispatch } from "react";
import type { AppAction } from "@/application/state/appState";
import type { ParameterPageActions } from "@/app/routes";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import type { ParameterRecord, Project } from "@/domain/prototype/types";
import { ParameterImportWizard } from "@/components/ParameterImportWizard/ParameterImportWizard";
import { TopBarActionsContext, useTopBarActions } from "@/components/layout";
import { useRefreshParameterAdminRecentAudits } from "./useRefreshParameterAdminRecentAudits";
import type { ApiClient } from "@/infrastructure/http/apiClient";

export type OrganizationBulkImportPanelProps = {
  apiClient?: ApiClient;
  projects: Project[];
  parameters: ParameterRecord[];
  activeProjectId: string;
  dispatch: Dispatch<AppAction>;
  onNavigate: (path: string) => void;
  parameterActions?: ParameterPageActions;
  runtimeMode?: WiseEffRuntimeMode;
};

/**
 * Organization-scoped bulk import entry shown as a TopBar action on every org sub-route.
 */
export function OrganizationBulkImportPanel({
  apiClient,
  projects,
  parameters,
  activeProjectId,
  dispatch,
  onNavigate,
  parameterActions,
  runtimeMode = "mock"
}: OrganizationBulkImportPanelProps) {
  const refreshRecentAudits = useRefreshParameterAdminRecentAudits(apiClient);
  const topBarContext = useContext(TopBarActionsContext);
  const [open, setOpen] = useState(false);

  const wrappedActions = useMemo((): ParameterPageActions | undefined => {
    if (!parameterActions) {
      return undefined;
    }
    return {
      ...parameterActions,
      async applyImportBatch(input) {
        const result = await parameterActions.applyImportBatch(input);
        await refreshRecentAudits(activeProjectId);
        return result;
      }
    };
  }, [activeProjectId, parameterActions, refreshRecentAudits]);

  const importButton = (
    <button
      type="button"
      className="button primary"
      aria-label="打开项目值批量导入"
      onClick={() => setOpen(true)}
    >
      <Upload size={16} aria-hidden="true" />
      项目值批量导入
    </button>
  );

  useTopBarActions(importButton, []);

  return (
    <>
      {!topBarContext ? (
        <div className="param-admin-org-actions" role="region" aria-label="项目值批量导入">
          {importButton}
        </div>
      ) : null}

      <ParameterImportWizard
        apiClient={apiClient}
        open={open}
        onClose={() => setOpen(false)}
        projects={projects}
        parameters={parameters}
        activeProjectId={activeProjectId}
        parameterActions={wrappedActions}
        dispatch={dispatch}
        onNavigate={onNavigate}
        runtimeMode={runtimeMode}
      />
    </>
  );
}
