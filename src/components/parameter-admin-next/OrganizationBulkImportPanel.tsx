import { Upload } from "lucide-react";
import { useContext, useMemo, useState, type Dispatch } from "react";
import type { AppAction } from "@/App";
import type { ParameterPageActions } from "@/app/routes";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import type { ParameterRecord, Project } from "@/mockData";
import { ParameterImportWizard } from "@/components/ParameterImportWizard/ParameterImportWizard";
import { TopBarActionsContext, useTopBarActions } from "@/components/layout";
import { useParameterAdmin } from "./ParameterAdminProvider";

export type OrganizationBulkImportPanelProps = {
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
  projects,
  parameters,
  activeProjectId,
  dispatch,
  onNavigate,
  parameterActions,
  runtimeMode = "mock"
}: OrganizationBulkImportPanelProps) {
  const { dispatch: adminDispatch } = useParameterAdmin();
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
        adminDispatch({
          type: "PUSH_AUDIT_HINT",
          hint: {
            kind: "import-batch-applied",
            summary: `已应用导入批次 ${input.batchId}`,
            reason: input.reviewMetadata?.notes ?? "",
            recordedAt: new Date().toISOString()
          }
        });
        return result;
      }
    };
  }, [adminDispatch, parameterActions]);

  const importButton = (
    <button
      type="button"
      className="button primary"
      aria-label="打开批量参数导入"
      onClick={() => setOpen(true)}
    >
      <Upload size={16} aria-hidden="true" />
      批量参数导入
    </button>
  );

  useTopBarActions(importButton, []);

  return (
    <>
      {!topBarContext ? (
        <div className="param-admin-org-actions" role="region" aria-label="批量参数导入">
          {importButton}
        </div>
      ) : null}

      <ParameterImportWizard
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
