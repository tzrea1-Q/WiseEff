import { Upload } from "lucide-react";
import { useMemo, useState, type Dispatch } from "react";
import type { AppAction } from "@/App";
import type { ParameterPageActions } from "@/app/routes";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import type { ParameterRecord, Project } from "@/mockData";
import { ParameterImportWizard } from "@/components/ParameterImportWizard/ParameterImportWizard";
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
 * Organization-scoped bulk import entry. Composes the existing five-step wizard;
 * import apply is wrapped so governance audit lands in admin-owned state.
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

  return (
    <section className="param-admin-main" aria-label="批量参数导入" style={{ paddingBottom: 0 }}>
      <div className="parameters-table-toolbar" style={{ marginBottom: "0.75rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>批量参数导入</h2>
          <p className="form-hint" style={{ margin: "0.25rem 0 0" }}>
            从组织目录侧导入表格、CSV、JSON 或完整 DTS，写入目标项目参数库。
          </p>
        </div>
        <button
          type="button"
          className="button primary"
          aria-label="打开批量参数导入"
          onClick={() => setOpen(true)}
        >
          <Upload size={16} aria-hidden="true" />
          批量参数导入
        </button>
      </div>

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
    </section>
  );
}
