import { useMemo, type RefObject } from "react";
import { FileCode2 } from "lucide-react";
import { SearchField } from "@/components/common/SearchField";

import type {
  ConfigSetRole,
  DtsConfigSet,
  DtsConfigSetMemberFile,
  DtsSearchHit,
  DtsStructuralNode,
  DtsStructureNavigation
} from "@/application/ports/DtsStructuredRepository";
import type { ProjectParameterFile } from "@/application/ports/ParameterFileRepository";
import type { SessionPropertyDraft } from "@/application/project-configuration/sessionDrafts";
import { WorkbenchStructureTree } from "./WorkbenchStructureTree";
import { selectWorkbenchNavigationNodes } from "./workbenchStructureTreeModel";

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
  showStructure?: boolean;
  treeRegionRef: RefObject<HTMLElement | null>;
  selectedConfigSet: DtsConfigSet;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchDraft: string;
  searchQuery?: string | null;
  onSearchDraftChange: (value: string) => void;
  onSearchSubmit: () => void;
  searchLoading: boolean;
  searchError: string;
  searchHits: DtsSearchHit[];
  onSearchHit: (hit: DtsSearchHit) => void;
  membersLoading: boolean;
  membersError: string;
  onMembersRetry: () => void;
  sourceWorkflowSetLoading: boolean;
  sourceWorkflowSetReady: boolean;
  memberAddErrorsByFileId: Readonly<Record<string, string>>;
  sourceWorkflowSetCanonical: boolean;
  sourceWorkflowSetError: string;
  selectedMembers: DtsConfigSetMemberFile[];
  selectedMember: DtsConfigSetMemberFile | null;
  onSelectMember: (fileId: string) => void;
  structureLoading: boolean;
  structureError: string;
  onStructureRetry: () => void;
  structureNodes: DtsStructuralNode[];
  organizationNavigation?: boolean;
  structureNavigation?: DtsStructureNavigation | null;
  structureNavigationError?: string;
  selectedNodePath: string | null;
  selectedPropertyName: string | null;
  sessionDrafts: Record<string, SessionPropertyDraft>;
  onSelectStructureTarget: (fileId: string, nodePath: string, propertyName: string | null) => void;
  canAdmin: boolean;
  filesLoading: boolean;
  filesError: string;
  onFilesRetry: () => void;
  ungroupedFiles: ProjectParameterFile[];
  pendingAction: string | null;
  onAssignUngroupedFile: (file: ProjectParameterFile) => void;
};

export function WorkbenchSourceTree({
  showStructure = true,
  treeRegionRef,
  selectedConfigSet,
  searchInputRef,
  searchDraft,
  searchQuery = null,
  onSearchDraftChange,
  onSearchSubmit,
  searchLoading,
  searchError,
  searchHits,
  onSearchHit,
  membersLoading,
  membersError,
  onMembersRetry,
  sourceWorkflowSetLoading,
  sourceWorkflowSetReady,
  memberAddErrorsByFileId,
  sourceWorkflowSetCanonical,
  sourceWorkflowSetError,
  selectedMembers,
  selectedMember,
  onSelectMember,
  structureLoading,
  structureError,
  onStructureRetry,
  structureNodes,
  organizationNavigation = false,
  structureNavigation = null,
  structureNavigationError = "",
  selectedNodePath,
  selectedPropertyName,
  sessionDrafts,
  onSelectStructureTarget,
  canAdmin,
  filesLoading,
  filesError,
  onFilesRetry,
  ungroupedFiles,
  pendingAction,
  onAssignUngroupedFile
}: WorkbenchSourceTreeProps) {
  const navigationNodes = useMemo(() => organizationNavigation
    ? structureNavigation?.status === "ready"
      ? selectWorkbenchNavigationNodes(structureNodes, structureNavigation.managedNodePaths)
      : []
    : structureNodes, [organizationNavigation, structureNavigation, structureNodes]);
  const navigationError = organizationNavigation && structureNavigation?.status !== "ready"
    ? structureNavigationError || "组织配置导航暂时不可用，请重试。" : "";
  const targetOutsideNavigation = organizationNavigation && structureNavigation?.status === "ready"
    && Boolean(selectedNodePath) && structureNodes.some((node) => node.nodePath === selectedNodePath)
    && !navigationNodes.some((node) => node.nodePath === selectedNodePath
      && (!selectedPropertyName || node.properties.some((property) => property.name === selectedPropertyName)));
  const sourceSetMutationBlocked =
    sourceWorkflowSetLoading ||
    !sourceWorkflowSetReady ||
    Boolean(sourceWorkflowSetError) ||
    sourceWorkflowSetCanonical;
  const sourceSetMutationReason = sourceWorkflowSetError
    ? sourceWorkflowSetError
    : sourceWorkflowSetCanonical
      ? "此配置的文件变更需要审核，当前不能直接加入文件。"
      : selectedMembers.length === 0
        ? "当前配置尚无已验证的来源文件，不能确认目标来源。"
      : "配置来源一致性尚未完成校验，文件变更已禁用。";

  return (
    <aside className="configuration-workbench__tree" aria-label="源结构" tabIndex={-1} ref={treeRegionRef}>
      <form
        className="configuration-workbench__search"
        aria-label="统一结构搜索"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchSubmit();
        }}
      >
        <SearchField
          ref={searchInputRef}
          value={searchDraft}
          onValueChange={onSearchDraftChange}
          placeholder="搜索配置，按回车确认"
          ariaLabel="统一搜索查询"
          loading={searchLoading}
        />
      </form>
      {searchError ? (
        <div role="alert" className="configuration-workbench__scoped-error">
          <p>{searchError}</p>
        </div>
      ) : null}
      {searchQuery !== null && !searchLoading && !searchError ? (
        <p className="configuration-workbench__search-summary" role="status">
          {searchHits.length ? `找到 ${searchHits.length} 个结果` : `未找到“${searchQuery}”`}
          <button className="button ghost" type="button" onClick={() => onSearchDraftChange("")}>清除搜索</button>
        </p>
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
      {membersLoading ? <p role="status">正在加载配置文件…</p> : null}
      {membersError ? (
        <div role="alert" className="configuration-workbench__scoped-error">
          <p>{membersError}</p>
          <button className="button subtle" type="button" onClick={onMembersRetry}>
            重试文件
          </button>
        </div>
      ) : null}
      {!membersLoading && !membersError && selectedMembers.length === 0 ? (
        <div className="configuration-workbench__empty">
          <strong>当前配置还没有文件</strong>
          <p>
            {canAdmin ? "从「配置 → 文件管理」添加文件。" : "请项目管理员添加来源文件。"}
          </p>
        </div>
      ) : null}
      <div
        role="tree"
        aria-label={`${selectedConfigSet.name === "default" ? "默认配置" : selectedConfigSet.name} 配置文件`}
        className="configuration-workbench__member-tree"
      >
        {selectedMembers.map((item) => {
          const roleLabel = ROLE_LABELS[item.role];
          const versionLabel = item.currentVersionNumber ? `v${item.currentVersionNumber}` : "无活跃版本";
          const selected = item.fileId === selectedMember?.fileId;
          return (
            // role="group": a tree may only own treeitem/group children, and this
            // block wraps the member treeitem together with its expanded subtree.
            <div key={item.fileId} role="group" className="configuration-workbench__member-block">
              <div className="configuration-workbench__member-row"
                role="treeitem"
                aria-selected={selected}
                aria-expanded={selected ? true : undefined}
                aria-label={`${item.fileName} ${roleLabel} ${versionLabel}`}
                tabIndex={0}
                onClick={() => onSelectMember(item.fileId)}
                onKeyDown={(event) => {
                  if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    onSelectMember(item.fileId);
                  }
                }}>
              <button
                type="button"
                tabIndex={-1}
                aria-label={`${item.fileName} ${roleLabel} ${versionLabel}`}
                className={`button subtle configuration-workbench__member${selected ? " is-selected" : ""}`}
              >
                <FileCode2 size={15} aria-hidden="true" />
                <span>
                  <strong title={item.fileName}>{item.fileName}</strong>
                  {/* Human-readable version label; the raw version id stays discoverable via tooltip (FA-23). */}
                  <small title={item.currentVersionId ?? undefined}>
                    {item.currentVersionNumber ? `版本 v${item.currentVersionNumber}` : "无活跃版本"}
                  </small>
                </span>
                <span className="configuration-workbench__member-meta" aria-hidden="true">
                  <span>{roleLabel}</span>
                </span>
              </button>
              </div>
              {selected && showStructure ? (
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
                  {!structureLoading && !structureError && navigationError ? (
                    <div role="alert" className="configuration-workbench__scoped-error">
                      <p>{navigationError}</p>
                      <button className="button subtle" type="button" onClick={onStructureRetry}>
                        重试配置导航
                      </button>
                    </div>
                  ) : null}
                  {!structureLoading && !structureError && !navigationError && targetOutsideNavigation ? (
                    <p role="status">目标不在当前导航范围，已定位到源码。</p>
                  ) : null}
                  {!structureLoading && !structureError && !navigationError ? (
                    <WorkbenchStructureTree
                      nodes={navigationNodes}
                      emptyMessage={organizationNavigation ? "当前文件没有匹配组织已登记模块的节点。" : undefined}
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
      {filesLoading || filesError || ungroupedFiles.length > 0 ? <div role="group" aria-label="待分配项目文件" className="configuration-workbench__ungrouped">
        <div className="configuration-workbench__ungrouped-title">
          <span>待分配</span>
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
        {ungroupedFiles.map((item) => (
          <div key={item.id} className="configuration-workbench__ungrouped-file">
            <span>{item.fileName}</span>
            <small>{memberAddErrorsByFileId[item.id] || "待分配"}</small>
            {canAdmin ? (
              <button
                className="button subtle"
                type="button"
                aria-label={`加入 ${item.fileName}`}
                title={sourceSetMutationBlocked ? sourceSetMutationReason : memberAddErrorsByFileId[item.id] || undefined}
                aria-describedby={sourceSetMutationBlocked ? "source-tree-member-add-reason" : undefined}
                disabled={pendingAction !== null || sourceSetMutationBlocked || Boolean(memberAddErrorsByFileId[item.id])}
                onClick={() => onAssignUngroupedFile(item)}
              >
                加入当前配置
              </button>
            ) : null}
          </div>
        ))}
        {ungroupedFiles.length > 0 && sourceSetMutationBlocked ? (
          <p id="source-tree-member-add-reason" role="note">{sourceSetMutationReason}
            {sourceWorkflowSetCanonical ? "" : " 未完成校验前不能加入当前配置。"}</p>
        ) : null}
      </div> : null}
    </aside>
  );
}
