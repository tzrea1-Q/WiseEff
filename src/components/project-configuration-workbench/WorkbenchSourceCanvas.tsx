import type { RefObject } from "react";
import { Info } from "lucide-react";

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
import type { WorkbenchCanvasMode } from "./workbenchInspectorModel";

export type WorkbenchSourceCanvasProps = {
  sourceRegionRef: RefObject<HTMLElement | null>;
  selectedConfigSetName: string;
  selectedMember: DtsConfigSetMemberFile | null;
  canvasMode: WorkbenchCanvasMode;
  historyVersionId: string | null;
  candidateId: string | null;
  activeCandidate: ParameterFileCandidate | null;
  fileVersions: ProjectParameterFileVersion[];
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
  candidateSource: string;
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
  sourceRegionRef,
  selectedConfigSetName,
  selectedMember,
  canvasMode,
  historyVersionId,
  candidateId,
  activeCandidate,
  fileVersions,
  onEnterCanvasMode,
  onExitSpecialCanvasMode,
  candidateError,
  sourceLoading,
  modeSourceLoading,
  sourceError,
  modeSourceError,
  onSourceRetry,
  onClearModeSourceError,
  source,
  historySource,
  candidateSource,
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
  return (
    <main className="configuration-workbench__source" aria-label="只读 DTS 源码" ref={sourceRegionRef}>
      {selectedMember ? (
        <header className="configuration-workbench__source-head">
          <div>
            <span>
              {selectedConfigSetName} /{" "}
              {canvasMode === "working"
                ? "工作配置"
                : canvasMode === "history"
                  ? "历史只读源码"
                  : canvasMode === "candidate"
                    ? "候选只读源码"
                    : "只读对比"}
            </span>
            <h2>{selectedMember.fileName}</h2>
          </div>
          <div className="configuration-workbench__version-identity">
            <span>
              {canvasMode === "working"
                ? "活跃文件版本"
                : canvasMode === "candidate"
                  ? "候选文件版本"
                  : "对照文件版本"}
            </span>
            {/* Working config shows the human version label; the raw id stays in the tooltip (FA-23). */}
            <strong
              className="mono"
              title={canvasMode === "working" ? selectedMember.currentVersionId ?? undefined : undefined}
            >
              {canvasMode === "working"
                ? selectedMember.currentVersionNumber
                  ? `v${selectedMember.currentVersionNumber}`
                  : "无活跃版本"
                : canvasMode === "candidate"
                  ? activeCandidate?.id ?? candidateId ?? "缺失"
                  : historyVersionId ?? "缺失"}
            </strong>
          </div>
          {canvasMode !== "working" ? (
            <div className="configuration-workbench__mode-actions">
              {canvasMode !== "candidate" && canvasMode !== "side-by-side" ? (
                <button
                  className="button subtle"
                  type="button"
                  onClick={() => onEnterCanvasMode("side-by-side", historyVersionId)}
                >
                  并排对比
                </button>
              ) : null}
              {canvasMode !== "candidate" && canvasMode !== "unified-diff" ? (
                <button
                  className="button subtle"
                  type="button"
                  onClick={() => onEnterCanvasMode("unified-diff", historyVersionId)}
                >
                  统一差异
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
                      ? "退出候选源码"
                      : "退出对比"
                }
              >
                {canvasMode === "history"
                  ? "退出历史源码"
                  : canvasMode === "candidate"
                    ? "退出候选源码"
                    : "退出对比"}
              </button>
            </div>
          ) : null}
        </header>
      ) : null}
      {canvasMode !== "working" ? (
        <p
          className="configuration-workbench__mode-banner"
          role="status"
          aria-label={
            canvasMode === "history"
              ? "历史只读源码模式"
              : canvasMode === "candidate"
                ? "候选只读源码模式"
                : "只读对比模式"
          }
        >
          当前为
          {canvasMode === "history"
            ? "历史只读源码"
            : canvasMode === "candidate"
              ? "候选只读源码"
              : "只读对比"}
          模式，不能编辑，也不会改变工作配置。
        </p>
      ) : null}
      {candidateError ? (
        <div className="configuration-workbench__setup-state" role="alert">
          {candidateError}
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
          <p>{sourceError || modeSourceError}</p>
          <button
            className="button subtle configuration-workbench__retry"
            type="button"
            onClick={() => (canvasMode === "working" ? onSourceRetry() : onClearModeSourceError())}
          >
            重试源码
          </button>
        </div>
      ) : null}
      {!sourceLoading && !modeSourceLoading && !sourceError && !modeSourceError && !selectedMember ? (
        <div className="configuration-workbench__source-state" role="status">
          <strong>没有可读取的成员源码</strong>
          <p>选择含成员文件的配置集后，活跃源码会显示在这里。</p>
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
          <strong>成员文件没有活跃版本</strong>
          <p>文件身份仍保留在树中；请在旧项目运营入口检查版本历史。</p>
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
          <p>当前活跃版本没有可显示的源码内容；可重试或回到旧项目运营入口检查版本历史。</p>
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
      source ? (
        <ProjectPrimaryDtsViewer
          className="configuration-workbench__code"
          fileName={selectedMember.fileName}
          versionNumber={selectedMember.currentVersionNumber ?? 0}
          text={source}
          focusSpan={restoredScrollLine != null ? null : focusSpan}
          focusLine={focusLineOverride ?? restoredScrollLine}
          findQuery={findQuery}
          findNextToken={findNextToken}
          onVisibleLineChange={onVisibleLineChange}
          sessionChangeMarkers={sessionChangeMarkers}
        />
      ) : null}
      {!modeSourceLoading &&
      !modeSourceError &&
      selectedMember &&
      canvasMode === "history" &&
      historySource ? (
        <ProjectPrimaryDtsViewer
          className="configuration-workbench__code"
          fileName={selectedMember.fileName}
          versionNumber={fileVersions.find((item) => item.id === historyVersionId)?.versionNumber ?? 0}
          text={historySource}
          focusLine={focusLineOverride}
          onVisibleLineChange={onVisibleLineChange}
        />
      ) : null}
      {!candidateLoading && canvasMode === "candidate" && candidateSource ? (
        <ProjectPrimaryDtsViewer
          className="configuration-workbench__code"
          fileName={activeCandidate?.fileName ?? selectedMember?.fileName ?? "candidate.dts"}
          versionNumber={0}
          text={candidateSource}
          focusLine={focusLineOverride}
          onVisibleLineChange={onVisibleLineChange}
        />
      ) : null}
      {canvasMode === "candidate" && candidateLoading ? (
        <div className="configuration-workbench__source-state" role="status">
          正在加载候选源码…
        </div>
      ) : null}
      {!modeSourceLoading &&
      !modeSourceError &&
      selectedMember &&
      canvasMode === "unified-diff" &&
      unifiedDiffText ? (
        <pre className="configuration-workbench__diff" aria-label="统一差异对比">
          {unifiedDiffText}
        </pre>
      ) : null}
      {!modeSourceLoading &&
      !modeSourceError &&
      selectedMember &&
      canvasMode === "side-by-side" &&
      historySource ? (
        <div className="configuration-workbench__side-by-side" aria-label="并排差异对比">
          <ProjectPrimaryDtsViewer
            className="configuration-workbench__code"
            fileName={`${selectedMember.fileName} · 工作配置`}
            versionNumber={selectedMember.currentVersionNumber ?? 0}
            text={compareSource || source}
            onVisibleLineChange={onVisibleLineChange}
          />
          <ProjectPrimaryDtsViewer
            className="configuration-workbench__code"
            fileName={`${selectedMember.fileName} · 历史`}
            versionNumber={fileVersions.find((item) => item.id === historyVersionId)?.versionNumber ?? 0}
            text={historySource}
          />
        </div>
      ) : null}
    </main>
  );
}
