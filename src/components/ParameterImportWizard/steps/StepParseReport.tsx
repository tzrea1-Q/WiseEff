import type { ParsedImportRow, ReviewedImportRow } from "@/application/parameters/import/types";

export type StepParseReportProps = {
  parsedRows: ParsedImportRow[];
  reviewedRows: ReviewedImportRow[];
  parseErrors: string[];
  onBack: () => void;
  onNext: () => void;
};

function countByStatus(rows: ReviewedImportRow[]) {
  let newCandidateCount = 0;
  let existingCount = 0;
  let conflictCount = 0;
  let needsModuleCount = 0;

  for (const row of rows) {
    if (row.status === "conflict") {
      conflictCount += 1;
    } else if (row.status === "needs-module") {
      needsModuleCount += 1;
    } else if (row.existingParameter) {
      existingCount += 1;
    } else {
      newCandidateCount += 1;
    }
  }

  return { newCandidateCount, existingCount, conflictCount, needsModuleCount };
}

export function StepParseReport({ parsedRows, reviewedRows, parseErrors, onBack, onNext }: StepParseReportProps) {
  const totalRows = parsedRows.length;
  const { newCandidateCount, existingCount, conflictCount, needsModuleCount } = countByStatus(reviewedRows);
  const canProceed = totalRows > 0;

  return (
    <section className="parameter-import-wizard-step" aria-label="解析与校验">
      <dl className="parameter-import-wizard-summary">
        <div className="parameter-import-wizard-summary-item">
          <dt>总行数</dt>
          <dd>{totalRows}</dd>
        </div>
        <div className="parameter-import-wizard-summary-item">
          <dt>新增候选</dt>
          <dd>{newCandidateCount}</dd>
        </div>
        <div className="parameter-import-wizard-summary-item">
          <dt>已有</dt>
          <dd>{existingCount}</dd>
        </div>
        <div className="parameter-import-wizard-summary-item">
          <dt>冲突</dt>
          <dd>{conflictCount}</dd>
        </div>
        <div className="parameter-import-wizard-summary-item">
          <dt>待补全模块</dt>
          <dd>{needsModuleCount}</dd>
        </div>
      </dl>

      {parseErrors.length > 0 ? (
        <div className="parameter-import-wizard-errors" role="alert">
          <p>解析错误：</p>
          <ul>
            {parseErrors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {totalRows === 0 ? (
        <p className="parameter-import-wizard-empty-hint">
          未解析到任何有效行，请返回上一步检查文件内容，或下载模板重新填写后再试。
        </p>
      ) : null}

      <div className="dialog-actions">
        <button type="button" className="button subtle" onClick={onBack}>
          上一步
        </button>
        <button type="button" className="button primary" disabled={!canProceed} onClick={onNext}>
          下一步
        </button>
      </div>
    </section>
  );
}
