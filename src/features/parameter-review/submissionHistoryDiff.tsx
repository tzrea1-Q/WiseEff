import { ReviewImpactList } from "@/components/parameters/ReviewImpactList";
import {
  type ChangeRequest,
  type ParameterRecord,
  type ParameterSubmissionItem,
  type ParameterSubmissionRound
} from "@/domain/prototype/types";
import {
  buildReviewDetailSummary,
  getParameterValueSummary,
  isRedundantReviewSummary,
  shouldShowReviewDetailReason,
  shouldSummarizeReviewChange
} from "@/parameterValueKind";
import { type ParameterValueKind } from "@/powerManagementConfig";
import { riskLabels } from "@/workbenchUi";
import { ArrowRight } from "lucide-react";

export function isComplexSubmissionHistoryItem(item: ParameterSubmissionItem) {
  return shouldSummarizeReviewChange({
    valueKind: item.valueKind,
    currentValue: item.currentValue,
    targetValue: item.targetValue
  });
}

function getSubmissionHistoryLineCount(value: string) {
  return value ? value.split(/\r?\n/).length : 0;
}

function formatSubmissionHistoryValue(value: string, unit: string, isComplexItem: boolean) {
  if (isComplexItem) {
    return value || "-";
  }
  return `${value || "-"} ${unit}`.trim();
}

type SubmissionHistoryDiffLineKind = "equal" | "remove" | "add";

type SubmissionHistoryDiffLine = {
  kind: SubmissionHistoryDiffLineKind;
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  value: string;
};

function splitSubmissionHistoryDiffLines(value: string) {
  const lines = value.split(/\r?\n/);
  return lines.length === 0 ? [""] : lines;
}

function buildSubmissionHistoryDiffLines(baseValue: string, targetValue: string): SubmissionHistoryDiffLine[] {
  const baseLines = splitSubmissionHistoryDiffLines(baseValue);
  const targetLines = splitSubmissionHistoryDiffLines(targetValue);
  const lineCount = Math.max(baseLines.length, targetLines.length);
  const diffLines: SubmissionHistoryDiffLine[] = [];

  for (let index = 0; index < lineCount; index += 1) {
    const baseLine = baseLines[index];
    const targetLine = targetLines[index];
    const baseLineNumber = baseLine === undefined ? null : index + 1;
    const targetLineNumber = targetLine === undefined ? null : index + 1;

    if (baseLine === targetLine) {
      diffLines.push({
        kind: "equal",
        leftLineNumber: baseLineNumber,
        rightLineNumber: targetLineNumber,
        value: baseLine ?? ""
      });
      continue;
    }

    if (baseLine !== undefined) {
      diffLines.push({
        kind: "remove",
        leftLineNumber: baseLineNumber,
        rightLineNumber: null,
        value: baseLine
      });
    }

    if (targetLine !== undefined) {
      diffLines.push({
        kind: "add",
        leftLineNumber: null,
        rightLineNumber: targetLineNumber,
        value: targetLine
      });
    }
  }

  return diffLines;
}

function SubmissionHistoryDiff({ baseValue, targetValue }: { baseValue: string; targetValue: string }) {
  const diffLines = buildSubmissionHistoryDiffLines(baseValue, targetValue);

  return (
    <div className="submission-preview-diff history-submission-diff" role="list">
      {diffLines.map((line, index) => (
        <div
          className="submission-preview-diff-row"
          data-kind={line.kind}
          key={`${line.kind}-${line.leftLineNumber ?? "-"}-${line.rightLineNumber ?? "-"}-${index}`}
          role="listitem"
        >
          <span className="submission-preview-diff-row__marker" aria-hidden="true">
            {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
          </span>
          <span className="submission-preview-diff-row__line-number">{line.leftLineNumber ?? ""}</span>
          <span className="submission-preview-diff-row__line-number">{line.rightLineNumber ?? ""}</span>
          <code>{line.value || " "}</code>
        </div>
      ))}
    </div>
  );
}

export function SubmissionHistoryDiffCard({ item }: { item: ParameterSubmissionItem }) {
  const isComplexItem = isComplexSubmissionHistoryItem(item);
  const sourceLabel = isComplexItem ? "DTS / 多行参数" : "数值配置";
  const currentDisplayValue = formatSubmissionHistoryValue(item.currentValue, item.unit, isComplexItem);
  const targetDisplayValue = formatSubmissionHistoryValue(item.targetValue, item.unit, isComplexItem);

  return (
    <article
      className={["submission-diff-card", "submission-diff-card--history", isComplexItem ? "submission-diff-card--history-complex" : ""]
        .filter(Boolean)
        .join(" ")}
      key={item.requestId}
    >
      <div className="submission-diff-card__head">
        <div>
          <strong>{item.name}</strong>
          <small>{item.module} · {riskLabels[item.risk]}</small>
        </div>
        <span>{isComplexItem ? "复杂配置" : "数值配置"}</span>
      </div>
      <div className="history-submission-meta-row" aria-label={`${item.name} 历史提交摘要`}>
        <span>{sourceLabel}</span>
        <span>当前 {getSubmissionHistoryLineCount(item.currentValue)} 行</span>
        <span>目标 {getSubmissionHistoryLineCount(item.targetValue)} 行</span>
      </div>
      <SubmissionHistoryDiff baseValue={currentDisplayValue} targetValue={targetDisplayValue} />
      <p>{item.reason}</p>
    </article>
  );
}

export function ReviewChangeValueSummary({
  request,
  parameter,
  layout = "inline"
}: {
  request: ChangeRequest;
  parameter?: { valueKind?: ParameterValueKind; configFormat?: string; name?: string };
  layout?: "inline" | "complex";
}) {
  if (shouldSummarizeReviewChange(request, parameter)) {
    const valueSummary = getParameterValueSummary(request.currentValue || request.targetValue);
    const differenceLabel = request.currentValue === request.targetValue ? "当前与目标一致" : "当前与目标不同";
    const tooltip = `${request.title} · ${valueSummary.lineCount} 行 · ${differenceLabel}`;

    if (layout === "complex") {
      return (
        <span className="review-change-complex-summary" title={tooltip}>
          <span className="review-change-complex-summary__title">{request.title}</span>
          <span className="review-change-complex-summary__meta">
            <span className="review-change-complex-badge">复杂配置</span>
            <small>{valueSummary.lineCount} 行 · {differenceLabel}</small>
          </span>
        </span>
      );
    }

    return (
      <span className="review-change-complex-summary__meta" title={tooltip}>
        <span className="review-change-complex-badge">复杂配置</span>
        <small>{valueSummary.lineCount} 行 · {differenceLabel}</small>
      </span>
    );
  }

  return (
    <span className="value-change__values">
      <span className="strike">{request.currentValue.trim() || "-"}</span>
      <ArrowRight size={14} />
      <strong>{request.targetValue.trim() || "-"}</strong>
    </span>
  );
}

export function ReviewDetailSummary({
  request,
  parameter,
  moduleName,
  moduleDescription,
  parameterDescription,
  onOpenSubmissionDetail
}: {
  request: ChangeRequest;
  parameter?: ParameterRecord;
  moduleName?: string;
  moduleDescription?: string;
  parameterDescription?: string;
  onOpenSubmissionDetail?: () => void;
}) {
  const summary = buildReviewDetailSummary({
    title: request.title,
    currentValue: request.currentValue,
    targetValue: request.targetValue,
    valueKind: request.valueKind ?? parameter?.valueKind,
    configFormat: parameter?.configFormat
  });
  const supplementalSummary = request.aiSummary.trim();
  const showSupplementalSummary =
    supplementalSummary.length > 0 && !isRedundantReviewSummary(supplementalSummary);
  const reasons = request.aiSuggestion?.reasons?.filter(shouldShowReviewDetailReason) ?? [];
  const resolvedModuleName = moduleName?.trim() || request.module;
  const resolvedModuleDescription = moduleDescription?.trim() || "";
  const resolvedParameterDescription = parameterDescription?.trim() || "";

  return (
    <div className="review-detail-summary">
      {summary.isComplex ? (
        <>
          <p className="review-detail-summary__headline">{summary.headline}</p>
          <div className="review-change-complex-summary__meta">
            <span className="review-change-complex-badge">复杂配置</span>
            <small>{summary.differenceLabel}</small>
          </div>
          {summary.hasDifference ? (
            <p className="review-detail-summary__hint">
              配置内容存在差异，请{" "}
              <button
                className="review-detail-summary__link"
                type="button"
                onClick={onOpenSubmissionDetail}
              >
                查看提交详情
              </button>
              {" "}了解行级对比。
            </p>
          ) : (
            <p className="review-detail-summary__hint">配置内容与目标一致。</p>
          )}
        </>
      ) : (
        <p className="review-detail-summary__headline">
          {showSupplementalSummary ? supplementalSummary : summary.headline}
        </p>
      )}
      {summary.isComplex && showSupplementalSummary ? (
        <p className="review-detail-summary__supplement">{supplementalSummary}</p>
      ) : null}
      {resolvedModuleDescription || resolvedParameterDescription ? (
        <dl className="review-identity-intros review-identity-intros--compact" aria-label="模块与参数介绍">
          {resolvedModuleDescription ? (
            <div className="review-identity-intros__item">
              <dt>模块介绍</dt>
              <dd aria-label={`${resolvedModuleName} 模块介绍`}>
                <span className="review-identity-intros__name">{resolvedModuleName}</span>
                {resolvedModuleDescription}
              </dd>
            </div>
          ) : null}
          {resolvedParameterDescription ? (
            <div className="review-identity-intros__item">
              <dt>参数含义</dt>
              <dd aria-label={`${request.title} 参数含义`}>
                <span className="review-identity-intros__name">{request.title}</span>
                {resolvedParameterDescription}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {reasons.length > 0 ? (
        <ul className="review-detail-summary__reasons">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      <ReviewImpactList items={request.impact} />
    </div>
  );
}

export function shouldShowSubmissionRoundSummary(round: ParameterSubmissionRound) {
  const summary = round.summary.trim();
  if (!summary) {
    return false;
  }
  return !/本轮提交包含\s*\d+\s*个参数/.test(summary);
}
