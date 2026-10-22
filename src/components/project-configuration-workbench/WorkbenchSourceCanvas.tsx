import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { CheckCircle2, Info } from "lucide-react";
import { SectionEmpty } from "@/components/common/SectionState";
import { presentErrorMessage } from "@/infrastructure/http/presentError";

import type { DtsConfigSetMemberFile } from "@/application/ports/DtsStructuredRepository";
import type {
  ParameterFileCandidate,
  ProjectParameterFileVersion
} from "@/application/ports/ParameterFileRepository";
import {
  ProjectPrimaryDtsViewer,
  type DtsViewerFocusSpan,
  type DtsViewerSessionChangeMarker
} from "@/components/parameter-topology/ProjectPrimaryDtsViewer";
import { buildUnifiedDiff, formatSourceCanvasEmpty, type WorkbenchCanvasMode } from "./workbenchInspectorModel";
import { candidateStatusLabels } from "./WorkbenchCandidateList";

export type WorkbenchSourceCanvasProps = {
  workingEditor?: ReactNode;
  sourceRegionRef: RefObject<HTMLElement | null>;
  selectedConfigSetName: string;
  selectedMember: DtsConfigSetMemberFile | null;
  canvasMode: WorkbenchCanvasMode;
  historyVersionId: string | null;
  candidateId: string | null;
  activeCandidate: ParameterFileCandidate | null;
  fileVersions: ProjectParameterFileVersion[];
  onSelectVersion?: () => void;
  onEnterCanvasMode: (mode: WorkbenchCanvasMode, versionId: string | null) => void;
  onExitSpecialCanvasMode: () => void;
  candidateError: string;
  sourceLoading: boolean;
  modeSourceLoading: boolean;
  sourceError: string;
  modeSourceError: string;
  onSourceRetry: () => void;
  onClearModeSourceError: () => void;
  source: string;
  historySource: string;
  historySourceAvailable?: boolean;
  candidateSource: string;
  candidateBaseSource?: string;
  candidateLoading: boolean;
  compareSource: string;
  unifiedDiffText: string;
  focusSpan: DtsViewerFocusSpan | null;
  focusLineOverride: number | null;
  restoredScrollLine: number | null;
  findQuery: string;
  findNextToken: number;
  onVisibleLineChange: (line: number) => void;
  sessionChangeMarkers: readonly DtsViewerSessionChangeMarker[];
};

export function WorkbenchSourceCanvas({
  workingEditor,
  sourceRegionRef,
  selectedConfigSetName,
  selectedMember,
  canvasMode,
  historyVersionId,
  candidateId,
  activeCandidate,
  fileVersions,
  onSelectVersion,
  onEnterCanvasMode,
  onExitSpecialCanvasMode,
  candidateError,
  sourceLoading: workingSourceLoading,
  modeSourceLoading,
  sourceError: workingSourceError,
  modeSourceError,
  onSourceRetry,
  onClearModeSourceError,
  source,
  historySource,
  historySourceAvailable = Boolean(historySource),
  candidateSource,
  candidateBaseSource,
  candidateLoading,
  compareSource,
  unifiedDiffText,
  focusSpan,
  focusLineOverride,
  restoredScrollLine,
  findQuery,
  findNextToken,
  onVisibleLineChange,
  sessionChangeMarkers
}: WorkbenchSourceCanvasProps) {
  const sourceLoading = canvasMode !== "candidate" && workingSourceLoading;
  const sourceError = canvasMode === "candidate" ? "" : workingSourceError;
  const sourceFormatLabel =
    (canvasMode === "candidate" ? activeCandidate?.format ?? selectedMember?.format : selectedMember?.format) === "json" ? "JSON" : "DTS";
  const sourceBodyAriaLabel = `${sourceFormatLabel} 源码`;
  const workingSource = historySourceAvailable ? compareSource : source;
  const emptyState = formatSourceCanvasEmpty(canvasMode, historyVersionId, historySource, workingSource, candidateId ? candidateSource : "", historySourceAvailable);
  const identical = Boolean(historyVersionId && historySourceAvailable && historySource === workingSource);
  const versionNumber = canvasMode === "working"
    ? selectedMember?.currentVersionNumber
    : fileVersions.find((version) => version.id === historyVersionId)?.versionNumber;
  const displayedFileName = canvasMode === "candidate"
    ? activeCandidate?.fileName ?? selectedMember?.fileName ?? "候选文件"
    : selectedMember?.fileName;
  const candidateDiff = activeCandidate?.id === candidateId
    ? candidateBaseSource !== undefined
      ? buildUnifiedDiff(candidateBaseSource, candidateSource, "更新前来源", "本次来源更新")
      : activeCandidate?.impact.textDiff ?? (!activeCandidate.fileId ? buildUnifiedDiff("", candidateSource, "新增文件", "本次来源更新") : "")
    : "";
  const displayedDiff = canvasMode === "candidate" ? candidateDiff : unifiedDiffText;
  const diffLines = displayedDiff.split("\n");
  const diffHeaderCount = diffLines[0]?.startsWith("# ") ? 3 : 2;
  const isChangedLine = (line: string, index: number) => index >= diffHeaderCount && /^[+-]/.test(line);
  const changeStarts = diffLines.flatMap((line, index) =>
    isChangedLine(line, index) && !isChangedLine(diffLines[index - 1] ?? "", index - 1) ? [index] : []);
  const changeStartSet = new Set(changeStarts);
  const diffLineRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const [activeChange, setActiveChange] = useState(-1);
  useEffect(() => setActiveChange(-1), [displayedDiff]);
  function focusChange(index: number) {
    const line = diffLineRefs.current.get(changeStarts[index]);
    if (!line) return;
    setActiveChange(index);
    line.focus({ preventScroll: true });
    line.scrollIntoView({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  return (
    <main className="configuration-workbench__source" aria-label={`${selectedConfigSetName} · ${workingEditor && canvasMode === "working" ? "" : "只读 "}${sourceFormatLabel} 源码`} ref={sourceRegionRef} tabIndex={-1}>
      {selectedMember || (canvasMode === "candidate" && candidateId) ? (
        <header className="configuration-workbench__source-head">
          <div>
            <h2>{displayedFileName}</h2>
            <span title={canvasMode === "candidate" ? candidateId ?? undefined : canvasMode === "working" ? selectedMember?.currentVersionId ?? undefined : historyVersionId ?? undefined}>
              {canvasMode === "working"
                ? "工作配置"
                : canvasMode === "history"
                  ? "历史版本 · 只读"
                  : canvasMode === "candidate"
                    ? `${activeCandidate ? candidateStatusLabels[activeCandidate.status] : "候选"} · 只读`
                    : "只读对比"}
              {canvasMode !== "candidate" && versionNumber ? ` · v${versionNumber}` : ""}
            </span>
          </div>
          {canvasMode !== "working" ? (
            <div className="configuration-workbench__mode-actions">
              {canvasMode !== "candidate" && canvasMode !== "unified-diff" ? (
                <button
                  className="button subtle"
                  type="button"
                  onClick={() => onEnterCanvasMode("unified-diff", historyVersionId)}
                >
                  对比
                </button>
              ) : null}
              <button
                className="button subtle"
                type="button"
                onClick={onExitSpecialCanvasMode}
                aria-label={
                  canvasMode === "history"
                    ? "退出历史源码"
                    : canvasMode === "candidate"
                      ? "返回工作配置"
                      : "退出对比"
                }
              >
                {canvasMode === "history"
                  ? "退出历史源码"
                  : canvasMode === "candidate"
                    ? "返回工作配置"
                    : "退出对比"}
              </button>
            </div>
          ) : null}
        </header>
      ) : null}
      {candidateError ? (
        <div className="configuration-workbench__setup-state" role="alert">
          {presentErrorMessage(candidateError, "候选源码加载失败。")}
        </div>
      ) : null}
      {!sourceLoading && !modeSourceLoading && !candidateLoading && !sourceError && !modeSourceError && !candidateError && selectedMember && emptyState ? (
        <div className="configuration-workbench__source-state" role="status">
          {identical ? <CheckCircle2 className="configuration-workbench__source-success" size={20} aria-hidden="true" /> : <Info size={20} aria-hidden="true" />}
          <SectionEmpty {...emptyState} onAction={historyVersionId ? onExitSpecialCanvasMode : fileVersions.length ? onSelectVersion : undefined} />
        </div>
      ) : null}
      {sourceLoading || modeSourceLoading ? (
        <div className="configuration-workbench__source-state" role="status">
          {canvasMode === "working" ? "正在加载活跃源码…" : "正在加载对照源码…"}
        </div>
      ) : null}
      {!sourceLoading && !modeSourceLoading && (sourceError || modeSourceError) ? (
        <div className="configuration-workbench__source-state" role="alert">
          <Info size={20} aria-hidden="true" />
          <strong>源码读取失败</strong>
          <p>{presentErrorMessage(sourceError || modeSourceError, "源码加载失败。")}</p>
          <button
            className="button subtle configuration-workbench__retry"
            type="button"
            onClick={() => (sourceError ? onSourceRetry() : onClearModeSourceError())}
          >
            重试源码
          </button>
        </div>
      ) : null}
      {!sourceLoading && !modeSourceLoading && !sourceError && !modeSourceError && !selectedMember && canvasMode !== "candidate" ? (
        <div className="configuration-workbench__source-state" role="status">
          <strong>没有可读取的文件源码</strong>
          <p>选择包含文件的配置后，活跃源码会显示在这里。</p>
        </div>
      ) : null}
      {!sourceLoading &&
      !modeSourceLoading &&
      !sourceError &&
      !modeSourceError &&
      selectedMember &&
      canvasMode === "working" &&
      !selectedMember.currentVersionId ? (
        <div className="configuration-workbench__source-state" role="status">
          <strong>配置文件没有活跃版本</strong>
          <p>文件身份仍保留在树中；请在「文件管理」中打开该文件的「版本历史与下载」检查。</p>
        </div>
      ) : null}
      {!sourceLoading &&
      !modeSourceLoading &&
      !sourceError &&
      !modeSourceError &&
      selectedMember &&
      canvasMode === "working" &&
      selectedMember.currentVersionId &&
      !source ? (
        <div className="configuration-workbench__source-state" role="status">
          <strong>源码内容为空</strong>
          <p>当前活跃版本没有可显示的源码内容；可重试或在「文件管理」中查看该文件的版本历史。</p>
          <button
            className="button subtle configuration-workbench__retry"
            type="button"
            onClick={onSourceRetry}
          >
            重试源码
          </button>
        </div>
      ) : null}
      {!sourceLoading &&
      !modeSourceLoading &&
      !sourceError &&
      !modeSourceError &&
      selectedMember &&
      canvasMode === "working" &&
      source && !workingEditor ? (
        <ProjectPrimaryDtsViewer
          className="configuration-workbench__code"
          fileName={selectedMember.fileName}
          hideHeader
          versionNumber={selectedMember.currentVersionNumber ?? undefined}
          text={source}
          focusSpan={restoredScrollLine != null ? null : focusSpan}
          focusLine={focusLineOverride ?? restoredScrollLine}
          findQuery={findQuery}
          findNextToken={findNextToken}
          onVisibleLineChange={onVisibleLineChange}
          sessionChangeMarkers={sessionChangeMarkers}
          bodyAriaLabel={sourceBodyAriaLabel}
        />
      ) : null}
      {workingEditor}
      {!modeSourceLoading &&
      !modeSourceError &&
      selectedMember &&
      canvasMode === "history" &&
      historySource ? (
        <ProjectPrimaryDtsViewer
          className="configuration-workbench__code"
          fileName={selectedMember.fileName}
          hideHeader
          versionNumber={fileVersions.find((item) => item.id === historyVersionId)?.versionNumber}
          text={historySource}
          focusLine={focusLineOverride}
          onVisibleLineChange={onVisibleLineChange}
          bodyAriaLabel={sourceBodyAriaLabel}
        />
      ) : null}
      {canvasMode === "candidate" && (candidateLoading || candidateId && activeCandidate?.id !== candidateId) ? (
        <div className="configuration-workbench__source-state" role="status">
          正在加载更新差异…
        </div>
      ) : null}
      {!candidateLoading && canvasMode === "candidate" && candidateId && activeCandidate?.id === candidateId && candidateSource && !candidateDiff ? (
        <ProjectPrimaryDtsViewer className="configuration-workbench__code" fileName={displayedFileName ?? "来源更新"}
          hideHeader text={candidateSource} bodyAriaLabel={sourceBodyAriaLabel} />
      ) : null}
      {!modeSourceLoading &&
      !modeSourceError &&
      (canvasMode === "candidate" ? !candidateLoading && candidateId && activeCandidate?.id === candidateId && candidateSource : selectedMember && canvasMode === "unified-diff") &&
      !emptyState &&
      displayedDiff ? (
        <section className="configuration-workbench__diff-panel" aria-label={canvasMode === "candidate" ? "来源更新差异" : "统一差异对比"}>
          {changeStarts.length > 0 ? <nav className="configuration-workbench__diff-nav" aria-label="差异导航">
            <span>{changeStarts.length} 处变更</span>
            <button className="button subtle" type="button" disabled={activeChange <= 0} onClick={() => focusChange(activeChange - 1)}>上一处变更</button>
            <button className="button subtle" type="button" disabled={activeChange >= changeStarts.length - 1} onClick={() => focusChange(activeChange + 1)}>下一处变更</button>
            {activeChange >= 0 ? <span role="status">第 {activeChange + 1} / {changeStarts.length} 处</span> : null}
          </nav> : null}
          <pre className="configuration-workbench__diff">
            {diffLines.map((line, index) => <span
              key={index}
              className={`configuration-workbench__diff-line ${index < diffHeaderCount ? "is-header" : line.startsWith("+") ? "is-added" : line.startsWith("-") ? "is-removed" : "is-context"}`}
              tabIndex={changeStartSet.has(index) ? -1 : undefined}
              ref={(element) => { if (element) diffLineRefs.current.set(index, element); else diffLineRefs.current.delete(index); }}
            >{line}{"\n"}</span>)}
          </pre>
        </section>
      ) : null}
    </main>
  );
}
