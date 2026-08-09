import type { RefObject } from "react";
import { ChevronLeft, ChevronRight, FileCode2, Search } from "lucide-react";

import type {
  ConfigSetRole,
  DtsConfigSet,
  DtsConfigSetMemberFile,
  DtsSearchHit,
  DtsStructuralNode
} from "@/application/ports/DtsStructuredRepository";
import type { ProjectParameterFile } from "@/application/ports/ParameterFileRepository";
import type { SessionPropertyDraft } from "@/application/project-configuration/sessionDrafts";
import { WorkbenchStructureTree } from "./WorkbenchStructureTree";

const ROLE_LABELS: Record<ConfigSetRole, string> = {
  base: "基础",
  overlay: "覆盖层",
  charging: "充电",
  thermal: "温控",
  misc: "其他"
};

function groupHitsByFile(
  hits: DtsSearchHit[]
): Array<{ fileId: string; fileName: string; hits: DtsSearchHit[] }> {
  const groups = new Map<string, { fileId: string; fileName: string; hits: DtsSearchHit[] }>();
  for (const hit of hits) {
    const existing = groups.get(hit.fileId);
    if (existing) {
      existing.hits.push(hit);
      continue;
    }
    groups.set(hit.fileId, {
      fileId: hit.fileId,
      fileName: hit.fileName,
      hits: [hit]
    });
  }
  return Array.from(groups.values());
}

export type WorkbenchSourceTreeProps = {
  treeOpen: boolean;
  onTreeOpenChange: (open: boolean) => void;
  treeRegionRef: RefObject<HTMLElement | null>;
  selectedConfigSet: DtsConfigSet;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchDraft: string;
  onSearchDraftChange: (value: string) => void;
  onSearchSubmit: () => void;
  searchLoading: boolean;
  searchError: string;
  searchHits: DtsSearchHit[];
  onSearchHit: (hit: DtsSearchHit) => void;
  membersLoading: boolean;
  membersError: string;
  onMembersRetry: () => void;
  selectedMembers: DtsConfigSetMemberFile[];
  selectedMember: DtsConfigSetMemberFile | null;
  onSelectMember: (fileId: string) => void;
  structureLoading: boolean;
  structureError: string;
  onStructureRetry: () => void;
  structureNodes: DtsStructuralNode[];
  selectedNodePath: string | null;
  selectedPropertyName: string | null;
  sessionDrafts: Record<string, SessionPropertyDraft>;
  onSelectStructureTarget: (fileId: string, nodePath: string, propertyName: string | null) => void;
  canAdmin: boolean;
  uploadingCandidate: boolean;
  onUploadCandidate: () => void;
  filesLoading: boolean;
  filesError: string;
  onFilesRetry: () => void;
  ungroupedFiles: ProjectParameterFile[];
  pendingAction: string | null;
  onAssignUngroupedFile: (file: ProjectParameterFile) => void;
};

export function WorkbenchSourceTree({
  treeOpen,
  onTreeOpenChange,
  treeRegionRef,
  selectedConfigSet,
  searchInputRef,
  searchDraft,
  onSearchDraftChange,
  onSearchSubmit,
  searchLoading,
  searchError,
  searchHits,
  onSearchHit,
  membersLoading,
  membersError,
  onMembersRetry,
  selectedMembers,
  selectedMember,
  onSelectMember,
  structureLoading,
  structureError,
  onStructureRetry,
  structureNodes,
  selectedNodePath,
  selectedPropertyName,
  sessionDrafts,
  onSelectStructureTarget,
  canAdmin,
  uploadingCandidate,
  onUploadCandidate,
  filesLoading,
  filesError,
  onFilesRetry,
  ungroupedFiles,
  pendingAction,
  onAssignUngroupedFile
}: WorkbenchSourceTreeProps) {
  if (!treeOpen) {
    return (
      <button
        type="button"
        className="button subtle configuration-workbench__tree-collapsed"
        aria-label="展开源结构"
        onClick={() => onTreeOpenChange(true)}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    );
  }

  return (
    <aside className="configuration-workbench__tree" aria-label="源结构" tabIndex={-1} ref={treeRegionRef}>
      <div className="configuration-workbench__region-head">
        <div>
          <span>源结构</span>
          <strong>{selectedConfigSet.name}</strong>
        </div>
        <button
          className="button subtle configuration-workbench__icon-button"
          type="button"
          aria-label="折叠源结构"
          onClick={() => onTreeOpenChange(false)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
      </div>
      <form
        className="configuration-workbench__search"
        aria-label="统一结构搜索"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchSubmit();
        }}
      >
        <input
          ref={searchInputRef}
          type="search"
          value={searchDraft}
          onChange={(event) => onSearchDraftChange(event.target.value)}
          placeholder="文件名 / 路径 / 属性…"
          aria-label="统一搜索查询"
        />
        <div className="configuration-workbench__search-actions">
          <button className="button subtle" type="submit" disabled={searchLoading}>
            <Search size={14} aria-hidden="true" />
            {searchLoading ? "搜索中…" : "搜索"}
          </button>
        </div>
      </form>
      {searchError ? (
        <div role="alert" className="configuration-workbench__scoped-error">
          <p>{searchError}</p>
        </div>
      ) : null}
      {searchHits.length > 0 ? (
        <div className="configuration-workbench__search-results" aria-label="搜索结果">
          {groupHitsByFile(searchHits).map((group) => (
            <div key={group.fileId} className="configuration-workbench__search-group">
              <strong>{group.fileName}</strong>
              <ul>
                {group.hits.map((hit, index) => (
                  <li key={`${hit.fileId}-${hit.nodePath}-${hit.propertyName ?? ""}-${index}`}>
                    <button type="button" className="button subtle" onClick={() => onSearchHit(hit)}>
                      <code>{hit.nodePath}</code>
                      {hit.propertyName ? <span> · {hit.propertyName}</span> : null}
                      {hit.snippet ? <small>{hit.snippet}</small> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
      {membersLoading ? <p role="status">正在加载成员文件…</p> : null}
      {membersError ? (
        <div role="alert" className="configuration-workbench__scoped-error">
          <p>{membersError}</p>
          <button className="button subtle" type="button" onClick={onMembersRetry}>
            重试成员
          </button>
        </div>
      ) : null}
      {!membersLoading && !membersError && selectedMembers.length === 0 ? (
        <div className="configuration-workbench__empty">
          <strong>当前配置集没有成员文件</strong>
          <p>
            从下方未编组文件编入成员，或上传候选后再明确分配。上传候选不会自动激活工作配置。
          </p>
          {canAdmin ? (
            <button
              className="button subtle"
              type="button"
              disabled={uploadingCandidate}
              onClick={onUploadCandidate}
            >
              {uploadingCandidate ? "上传中…" : "上传候选"}
            </button>
          ) : null}
        </div>
      ) : null}
      <div
        role="tree"
        aria-label={`${selectedConfigSet.name} 成员文件`}
        className="configuration-workbench__member-tree"
      >
        {selectedMembers.map((item) => {
          const roleLabel = ROLE_LABELS[item.role];
          const versionLabel = item.currentVersionNumber ? `v${item.currentVersionNumber}` : "无活跃版本";
          const selected = item.fileId === selectedMember?.fileId;
          return (
            <div key={item.fileId} className="configuration-workbench__member-block">
              <button
                type="button"
                role="treeitem"
                aria-selected={selected}
                aria-expanded={selected ? true : undefined}
                aria-label={`${item.fileName} ${roleLabel} ${versionLabel}`}
                className={`button subtle configuration-workbench__member${selected ? " is-selected" : ""}`}
                onClick={() => onSelectMember(item.fileId)}
              >
                <FileCode2 size={15} aria-hidden="true" />
                <span>
                  <strong title={item.fileName}>{item.fileName}</strong>
                  <small className="mono" title={item.currentVersionId ?? undefined}>
                    {item.currentVersionId ?? "版本身份缺失"}
                  </small>
                </span>
                <span className="configuration-workbench__member-meta" aria-hidden="true">
                  <span>{roleLabel}</span>
                  <span>{versionLabel}</span>
                </span>
              </button>
              {selected ? (
                <div className="configuration-workbench__node-tree-wrap">
                  {structureLoading ? <p role="status">正在加载结构树…</p> : null}
                  {structureError ? (
                    <div role="alert" className="configuration-workbench__scoped-error">
                      <p>{structureError}</p>
                      <button className="button subtle" type="button" onClick={onStructureRetry}>
                        重试结构树
                      </button>
                    </div>
                  ) : null}
                  {!structureLoading && !structureError ? (
                    <WorkbenchStructureTree
                      nodes={structureNodes}
                      fileId={item.fileId}
                      selectedNodePath={selectedNodePath}
                      selectedPropertyName={selectedPropertyName}
                      sessionDrafts={sessionDrafts}
                      ariaLabel={`${item.fileName} 节点树`}
                      onSelectNode={(nodePath) => onSelectStructureTarget(item.fileId, nodePath, null)}
                      onSelectProperty={(nodePath, propertyName) =>
                        onSelectStructureTarget(item.fileId, nodePath, propertyName)
                      }
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div role="group" aria-label="未编组项目文件" className="configuration-workbench__ungrouped">
        <div className="configuration-workbench__ungrouped-title">
          <span>未编组项目文件</span>
          <small>{filesLoading ? "…" : ungroupedFiles.length}</small>
        </div>
        {filesError ? (
          <div role="alert" className="configuration-workbench__scoped-error">
            <p>{filesError}</p>
            <button className="button subtle" type="button" onClick={onFilesRetry}>
              重试项目文件
            </button>
          </div>
        ) : null}
        {!filesError && !filesLoading && ungroupedFiles.length === 0 ? <p>没有未编组文件。</p> : null}
        {ungroupedFiles.map((item) => (
          <div key={item.id} className="configuration-workbench__ungrouped-file">
            <span>{item.fileName}</span>
            <small>不参与当前工作配置与发布就绪度</small>
            {canAdmin ? (
              <button
                className="button subtle"
                type="button"
                aria-label={`编入 ${item.fileName}`}
                disabled={pendingAction !== null}
                onClick={() => onAssignUngroupedFile(item)}
              >
                编入当前配置集
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  );
}
