import { CircleX } from "lucide-react";
import { useEffect, useMemo, useState, type Dispatch } from "react";
import type { AppAction } from "@/App";
import type { ParameterPageActions } from "@/app/routes";
import { buildImportTemplateWorkbook } from "@/application/parameters/import/buildImportTemplate";
import { ProjectAdminFormDialog } from "@/components/admin/ProjectAdminFormDialog";
import { createParameterAdminClient } from "@/infrastructure/http/parameterAdminClient";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import type { ParameterRecord, Project } from "@/mockData";
import { StepSourceAndProject } from "./steps/StepSourceAndProject";

export type ParameterImportWizardStep = 1 | 2 | 3 | 4 | 5;

export type ParameterImportWizardProps = {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  parameters: ParameterRecord[];
  activeProjectId: string;
  parameterActions?: ParameterPageActions;
  dispatch: Dispatch<AppAction>;
  onNavigate: (path: string) => void;
  runtimeMode?: WiseEffRuntimeMode;
};

const TEMPLATE_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function slugifyProjectCode(code: string) {
  return code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function downloadImportTemplate() {
  const bytes = Uint8Array.from(buildImportTemplateWorkbook());
  const blob = new Blob([bytes], { type: TEMPLATE_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "参数导入模板.xlsx";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ParameterImportWizard({
  open,
  onClose,
  projects,
  activeProjectId,
  parameterActions,
  dispatch,
  runtimeMode
}: ParameterImportWizardProps) {
  const isApiMode = runtimeMode === "api";
  const adminClient = useMemo(() => createParameterAdminClient(), []);
  const [step, setStep] = useState<ParameterImportWizardStep>(1);
  const [targetProjectId, setTargetProjectId] = useState(activeProjectId);
  const [sourceName, setSourceName] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectPending, setCreateProjectPending] = useState(false);
  const [createProjectError, setCreateProjectError] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setStep(1);
    setTargetProjectId(activeProjectId);
    setSourceName("");
    setSourceText("");
    setSourceBytes(null);
    setCreateProjectOpen(false);
    setCreateProjectError("");
  }, [open, activeProjectId]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !createProjectPending) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, createProjectPending]);

  if (!open) {
    return null;
  }

  const handleCreateProject = async (input: { name: string; code: string }) => {
    setCreateProjectPending(true);
    setCreateProjectError("");
    try {
      if (isApiMode) {
        const created = await adminClient.createProject({ name: input.name, code: input.code });
        await parameterActions?.refresh();
        setTargetProjectId(created.id);
      } else {
        const id = slugifyProjectCode(input.code) || `project-${Date.now()}`;
        dispatch({ type: "ADD_PARAMETER_ADMIN_PROJECT", project: { id, name: input.name, code: input.code } });
        setTargetProjectId(id);
      }
      setCreateProjectOpen(false);
    } catch (error) {
      setCreateProjectError(error instanceof Error ? error.message : "创建项目失败。");
    } finally {
      setCreateProjectPending(false);
    }
  };

  return (
    <>
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="批量参数导入向导">
        <div className="submission-dialog parameter-import-wizard">
          <div className="submission-dialog-head param-admin-editor-dialog-head">
            <div className="param-admin-editor-dialog-head-text">
              <span className="eyebrow">批量参数导入</span>
              <h2>步骤 {step} / 5</h2>
              <p>选择目标项目与导入来源，逐步核对后再应用变更。</p>
            </div>
            <button type="button" className="audit-dialog-close-icon" onClick={onClose} aria-label="关闭">
              <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>

          {step === 1 ? (
            <StepSourceAndProject
              projects={projects}
              targetProjectId={targetProjectId}
              onTargetProjectChange={setTargetProjectId}
              onCreateProject={() => {
                setCreateProjectError("");
                setCreateProjectOpen(true);
              }}
              sourceName={sourceName}
              sourceText={sourceText}
              sourceBytes={sourceBytes}
              onSourceChange={({ name, text, bytes }) => {
                setSourceName(name);
                setSourceText(text);
                setSourceBytes(bytes);
              }}
              onDownloadTemplate={downloadImportTemplate}
              onNext={() => setStep(2)}
            />
          ) : (
            <section className="parameter-import-wizard-step" aria-label={`步骤 ${step}`}>
              <p>该步骤正在开发中。</p>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="button subtle"
                  onClick={() => setStep((current) => Math.max(1, current - 1) as ParameterImportWizardStep)}
                >
                  上一步
                </button>
              </div>
            </section>
          )}
        </div>
      </div>

      <ProjectAdminFormDialog
        open={createProjectOpen}
        mode="create"
        loading={createProjectPending}
        error={createProjectError}
        onClose={() => {
          if (!createProjectPending) {
            setCreateProjectOpen(false);
            setCreateProjectError("");
          }
        }}
        onSubmit={handleCreateProject}
      />
    </>
  );
}
