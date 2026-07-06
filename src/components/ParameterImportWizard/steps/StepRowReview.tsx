import type { ParsedImportRow, ReviewedImportRow } from "@/application/parameters/import/types";
import type { Project } from "@/mockData";
import type { PowerManagementParameterTemplate } from "@/powerManagementConfig";
import { ImportReviewCard } from "../ImportReviewCard";

export type StepRowReviewProps = {
  reviewedRows: ReviewedImportRow[];
  projects: Project[];
  moduleNames: string[];
  libraryParameters: PowerManagementParameterTemplate[];
  onApproveRow: (rowId: string) => void;
  onSkipRow: (rowId: string, reason: string) => void;
  onUpdateRow: (rowId: string, patch: Partial<ParsedImportRow>) => void;
  onConfirmNewRow: (rowId: string, patch: Partial<ParsedImportRow>) => void;
  onBack: () => void;
  onNext: () => void;
};

const RESOLVED_STATUSES = new Set<ReviewedImportRow["status"]>(["approved", "skipped", "new-confirmed"]);

export function StepRowReview({
  reviewedRows,
  projects,
  moduleNames,
  libraryParameters,
  onApproveRow,
  onSkipRow,
  onUpdateRow,
  onConfirmNewRow,
  onBack,
  onNext
}: StepRowReviewProps) {
  const totalExcludingSkipped = reviewedRows.filter((row) => row.status !== "skipped").length;
  const confirmedCount = reviewedRows.filter((row) => row.status === "approved" || row.status === "new-confirmed").length;
  const allRowsResolved = reviewedRows.length > 0 && reviewedRows.every((row) => RESOLVED_STATUSES.has(row.status));

  return (
    <section className="parameter-import-wizard-step" aria-label="逐行核对">
      <p className="parameter-import-wizard-progress">
        已核对 {confirmedCount}/{totalExcludingSkipped}
      </p>

      <div className="import-review-list">
        {reviewedRows.map((row) => (
          <ImportReviewCard
            key={row.rowId}
            row={row}
            projects={projects}
            moduleNames={moduleNames}
            libraryParameters={libraryParameters}
            onApprove={onApproveRow}
            onSkip={onSkipRow}
            onUpdate={onUpdateRow}
            onConfirmNew={onConfirmNewRow}
          />
        ))}
      </div>

      <div className="dialog-actions">
        <button type="button" className="button subtle" onClick={onBack}>
          上一步
        </button>
        <button type="button" className="button primary" disabled={!allRowsResolved} onClick={onNext}>
          下一步
        </button>
      </div>
    </section>
  );
}
