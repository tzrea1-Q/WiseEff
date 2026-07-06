import { CircleX } from "lucide-react";
import { useEffect, useMemo, useState, type Dispatch } from "react";
import type { AppAction } from "@/App";
import type { ParameterPageActions } from "@/app/routes";
import { buildImportTemplateWorkbook } from "@/application/parameters/import/buildImportTemplate";
import { parseImportSource } from "@/application/parameters/import/detectImportFormat";
import { findExistingParameter, matchToLibrary } from "@/application/parameters/import/matchToLibrary";
import type { ParsedImportRow, ReviewedImportRow } from "@/application/parameters/import/types";
import type { ParameterImportBatchDto } from "@/application/ports/ParameterRepository";
import { ProjectAdminFormDialog } from "@/components/admin/ProjectAdminFormDialog";
import { createParameterAdminClient } from "@/infrastructure/http/parameterAdminClient";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import type { ParameterRecord, Project } from "@/mockData";
import { buildParameterLibraryFromRecords, buildParameterModulesFromRecords } from "@/parameterAdminLibrary";
import { listParameterModuleNames } from "@/powerManagementConfig";
import { StepBatchPreview } from "./steps/StepBatchPreview";
import { StepConfirmApply } from "./steps/StepConfirmApply";
import { StepParseReport } from "./steps/StepParseReport";
import { StepRowReview } from "./steps/StepRowReview";
import { StepSourceAndProject } from "./steps/StepSourceAndProject";

const RESOLVED_ROW_STATUSES = new Set<ReviewedImportRow["status"]>(["approved", "skipped", "new-confirmed"]);

function reviewRowMatchKey(row: ReviewedImportRow): string {
  return `${row.name}::${row.module}`;
}

function reconcileReviewedRows(rows: ReviewedImportRow[], parameters: ParameterRecord[], targetProjectId: string): ReviewedImportRow[] {
  const matchKeyCounts = new Map<string, number>();
  for (const row of rows) {
    const key = reviewRowMatchKey(row);
    matchKeyCounts.set(key, (matchKeyCounts.get(key) ?? 0) + 1);
  }

  return rows.map((row) => {
    const matchKey = reviewRowMatchKey(row);
    if (RESOLVED_ROW_STATUSES.has(row.status)) {
      return { ...row, matchKey };
    }

    const duplicateInBatch = (matchKeyCounts.get(matchKey) ?? 0) > 1;
    if (duplicateInBatch) {
      return { ...row, matchKey, status: "conflict" as const, existingParameter: undefined };
    }

    if (!row.module.trim()) {
      return { ...row, matchKey, status: "needs-module" as const, existingParameter: undefined };
    }

    const existingParameter = findExistingParameter(row.name, row.module, parameters, targetProjectId);
    return {
      ...row,
      matchKey,
      status: "pending" as const,
      existingParameter
    };
  });
}

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

const WIZARD_STEP_LABELS = ["来源与项目", "解析校验", "逐行核对", "批次预览", "确认应用"] as const;

const PROJECT_CHANGE_RESET_MESSAGE = "更改项目将重新匹配 diff，已核对进度会重置。";

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
  parameters,
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
  const [parsedRows, setParsedRows] = useState<ParsedImportRow[]>([]);
  const [reviewedRows, setReviewedRows] = useState<ReviewedImportRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [previewBatch, setPreviewBatch] = useState<ParameterImportBatchDto | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  const libraryParameters = useMemo(() => buildParameterLibraryFromRecords(parameters, projects), [parameters, projects]);
  const moduleNames = useMemo(
    () => listParameterModuleNames(buildParameterModulesFromRecords(parameters)),
    [parameters]
  );

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
    setParsedRows([]);
    setReviewedRows([]);
    setParseErrors([]);
    setPreviewBatch(null);
    setSelectedItemIds(new Set());
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

  const parseAndMatch = (projectId: string) => {
    const errors: string[] = [];
    let parsed: ParsedImportRow[] = [];
    try {
      parsed = parseImportSource({
        fileName: sourceName || undefined,
        bytes: sourceBytes ?? undefined,
        text: sourceText || undefined
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "解析失败，请检查文件内容。");
    }
    setParsedRows(parsed);
    setReviewedRows(matchToLibrary(parsed, parameters, projectId));
    setParseErrors(errors);
  };

  const handleParseAndAdvance = () => {
    parseAndMatch(targetProjectId);
    setStep(2);
  };

  const handleTargetProjectChange = (nextProjectId: string) => {
    if (nextProjectId === targetProjectId) {
      return;
    }
    if (step >= 3) {
      if (!window.confirm(PROJECT_CHANGE_RESET_MESSAGE)) {
        return;
      }
      setTargetProjectId(nextProjectId);
      parseAndMatch(nextProjectId);
      setPreviewBatch(null);
      setSelectedItemIds(new Set());
      setStep(2);
      return;
    }
    setTargetProjectId(nextProjectId);
  };

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

  const handleApproveRow = (rowId: string) => {
    setReviewedRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, status: "approved" as const } : row)));
  };

  const handleSkipRow = (rowId: string, reason: string) => {
    setReviewedRows((current) =>
      current.map((row) => (row.rowId === rowId ? { ...row, status: "skipped" as const, skipReason: reason } : row))
    );
  };

  const handleUpdateRow = (rowId: string, patch: Partial<ParsedImportRow>) => {
    setReviewedRows((current) => {
      const updated = current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row));
      return reconcileReviewedRows(updated, parameters, targetProjectId);
    });
  };

  const handleConfirmNewRow = (rowId: string, patch: Partial<ParsedImportRow>) => {
    setReviewedRows((current) =>
      current.map((row) => (row.rowId === rowId ? { ...row, ...patch, status: "new-confirmed" as const } : row))
    );
  };

  return (
    <>
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="批量参数导入向导">
        <div className="submission-dialog submission-dialog--wide parameter-import-wizard">
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

          <nav className="parameter-import-wizard-steps" aria-label="导入步骤">
            {WIZARD_STEP_LABELS.map((label, index) => {
              const stepNumber = (index + 1) as ParameterImportWizardStep;
              const classNames = [
                step === stepNumber ? "active" : "",
                step > stepNumber ? "complete" : ""
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <span key={label} className={classNames || undefined} aria-current={step === stepNumber ? "step" : undefined}>
                  <small>{stepNumber}</small>
                  {label}
                </span>
              );
            })}
          </nav>

          {step >= 3 ? (
            <div className="parameter-import-wizard-project-bar">
              <label className="parameter-import-wizard-project-switch">
                <span>目标项目</span>
                <select
                  aria-label="目标项目"
                  value={targetProjectId}
                  onChange={(event) => handleTargetProjectChange(event.target.value)}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}（{project.code}）
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          {step === 1 ? (
            <StepSourceAndProject
              projects={projects}
              targetProjectId={targetProjectId}
              onTargetProjectChange={handleTargetProjectChange}
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
              onNext={handleParseAndAdvance}
            />
          ) : step === 2 ? (
            <StepParseReport
              parsedRows={parsedRows}
              reviewedRows={reviewedRows}
              parseErrors={parseErrors}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          ) : step === 3 ? (
            <StepRowReview
              reviewedRows={reviewedRows}
              projects={projects}
              moduleNames={moduleNames}
              libraryParameters={libraryParameters}
              onApproveRow={handleApproveRow}
              onSkipRow={handleSkipRow}
              onUpdateRow={handleUpdateRow}
              onConfirmNewRow={handleConfirmNewRow}
              onBack={() => setStep(2)}
              onNext={() => setStep(4)}
            />
          ) : step === 4 ? (
            <StepBatchPreview
              targetProjectId={targetProjectId}
              sourceName={sourceName}
              reviewedRows={reviewedRows}
              parameterActions={parameterActions}
              dispatch={dispatch}
              previewBatch={previewBatch}
              selectedItemIds={selectedItemIds}
              onPreviewBatchChange={setPreviewBatch}
              onSelectedItemIdsChange={setSelectedItemIds}
              onBack={() => setStep(3)}
              onNext={() => setStep(5)}
            />
          ) : (
            <StepConfirmApply
              project={projects.find((project) => project.id === targetProjectId)}
              sourceName={sourceName}
              previewBatch={previewBatch}
              selectedItemIds={selectedItemIds}
              parameterActions={parameterActions}
              dispatch={dispatch}
              onBack={() => setStep(4)}
              onApplied={onClose}
            />
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
