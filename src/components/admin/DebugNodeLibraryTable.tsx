import { SearchField } from "@/components/common/SearchField";
import { filterItems } from "@/lib/search";
import { debugNodeSearchProfile } from "@/lib/search/profiles";
import { useMemo } from "react";
import { buildParameterModuleFilterNodes } from "@/application/parameters/buildModuleFilterNodes";
import type { DataTableSort } from "@/components/admin/DataTable";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SectionSkeleton } from "@/components/common/SectionState";
import { LibrarySelectFilter } from "@/components/admin/LibrarySelectFilter";
import { ColumnFilter } from "@/components/ColumnFilter";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import type { DebugNodeRegistryEntry } from "@/domain/debugging/types";
import type { DebugNodeLibrarySearch } from "@/application/debugging/debugNodeCatalogSearch";
import { bindingForProtocol, nodeBindingStatus } from "@/debugAdminDraft";
import { debugNodeModuleId, filterDebugNodesByModuleTree, modulePathLabelForDebugNode } from "@/debugAdminModules";
import "./debug-admin-library-table.css";

export type { DebugNodeLibrarySearch } from "@/application/debugging/debugNodeCatalogSearch";

const PROTOCOL_OPTIONS: Array<{ value: DebugNodeLibrarySearch["protocol"]; label: string }> = [
  { value: "all", label: "协议 · 全部" },
  { value: "hdc", label: "协议 · HDC" },
  { value: "adb", label: "协议 · ADB" }
];

const LIBRARY_PAGE_SIZE = 50;

function filterNodes(
  nodes: readonly DebugNodeRegistryEntry[],
  search: DebugNodeLibrarySearch,
  moduleNodes: readonly FlatModuleNode[]
) {
  const byModule = filterDebugNodesByModuleTree(nodes, moduleNodes, search.modules);
  const searched = search.q.trim() ? filterItems(byModule, search.q, debugNodeSearchProfile) : byModule;

  return searched.filter((node) => {
    if (search.protocol !== "all" && nodeBindingStatus(node.bindings, search.protocol) === "missing") {
      return false;
    }

    return true;
  });
}

function parseLibrarySort(sort: string): DataTableSort {
  if (sort.endsWith("-desc")) {
    return { key: sort.slice(0, -5), direction: "desc" };
  }
  if (sort.endsWith("-asc")) {
    return { key: sort.slice(0, -4), direction: "asc" };
  }
  return { key: "name", direction: "asc" };
}

export type DebugNodeLibraryTableProps = {
  nodes: readonly DebugNodeRegistryEntry[];
  moduleNodes: readonly FlatModuleNode[];
  search: DebugNodeLibrarySearch;
  onUpdateSearch: (patch: Partial<DebugNodeLibrarySearch>) => void;
  onEdit: (nodeId: string) => void;
  onDisable: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onCreate?: () => void;
  onManageModules?: () => void;
  onExport?: () => void;
  onImport?: () => void;
  canEdit?: boolean;
  loading?: boolean;
};

export function DebugNodeLibraryTable({
  nodes,
  moduleNodes,
  search,
  onUpdateSearch,
  onEdit,
  onDisable,
  onDelete,
  onCreate,
  onManageModules,
  onExport,
  onImport,
  canEdit = true,
  loading = false
}: DebugNodeLibraryTableProps) {
  const filtered = filterNodes(nodes, search, moduleNodes);
  const moduleFilterNodes = useMemo(() => {
    const preModuleRows = filterNodes(nodes, { ...search, modules: [] }, moduleNodes);
    return buildParameterModuleFilterNodes(
      preModuleRows.map((node) => ({
        moduleId: debugNodeModuleId(node, moduleNodes),
        moduleName: node.module,
        modulePath: node.modulePath
      })),
      moduleNodes.map((node) => ({
        id: node.id,
        name: node.name,
        parentId: node.parentId,
        sortOrder: node.sortOrder
      }))
    );
  }, [moduleNodes, nodes, search]);
  const filtersActive = search.q.trim().length > 0 || search.protocol !== "all" || search.modules.length > 0;
  const tableSort = parseLibrarySort(search.sort);

  const clearFilters = () => {
    onUpdateSearch({
      q: "",
      protocol: "all",
      modules: []
    });
  };

  return (
    <section className="debug-admin-library-table" aria-label="可调节点目录" aria-busy={loading}>
      <AdminListPage label="可调节点目录"
        headerContent={<h2 className="debug-node-catalog-title">可调节点目录</h2>}
        tableState={loading && nodes.length === 0 ? <SectionSkeleton label="正在加载可调节点" /> : undefined}
        headerActions={
        <div className="param-admin-library-heading-actions">
          {onExport ? (
            <button
              className="button subtle"
              type="button"
              onClick={onExport}
              disabled={!canEdit || loading}
              title={canEdit ? undefined : "缺少 debugging:admin 权限"}
            >
              导出全部节点
            </button>
          ) : null}
          {onImport ? (
            <button
              className="button subtle"
              type="button"
              onClick={onImport}
              disabled={!canEdit || loading}
              title={canEdit ? undefined : "缺少 debugging:admin 权限"}
            >
              导入节点
            </button>
          ) : null}
          {onManageModules ? (
            <button className="button subtle" type="button" onClick={onManageModules} disabled={loading}>
              模块管理
            </button>
          ) : null}
          {onCreate ? (
            <button className="button primary" type="button" onClick={onCreate} disabled={!canEdit || loading}>
              新增节点
            </button>
          ) : null}
        </div>}
        table={{
          rows: filtered, rowKey: (node) => node.id, pageSize: LIBRARY_PAGE_SIZE,
          page: search.page, onPageChange: (page) => onUpdateSearch({ page }),
          tableClassName: "debug-node-catalog-table",
          sort: tableSort, onSort: (key) => {
            const nextDirection = tableSort.key === key && tableSort.direction === "asc" ? "desc" : "asc";
            onUpdateSearch({ sort: `${key}-${nextDirection}` });
          },
          onRowClick: canEdit && !loading ? (node) => onEdit(node.id) : undefined,
          ariaLabel: "可调节点目录",
          columns: [
            {
              key: "name",
              header: "节点名",
              sortAccessor: (node) => node.name,
              render: (node) => (
                <div className="debug-admin-library-name">
                  <strong title={node.name}>{node.name}</strong>
                  {node.description ? <small title={node.description}>{node.description}</small> : null}
                </div>
              )
            },
            {
              key: "module",
              header: "模块",
              headerFilter: (
                <ColumnFilter
                  label="模块"
                  groupLabel="所属模块筛选"
                  mode="tree"
                  treeNodes={moduleFilterNodes}
                  selectedTreeIds={search.modules}
                  onTreeChange={(modules) => onUpdateSearch({ modules })}
                  treeSearchable
                  onClear={() => onUpdateSearch({ modules: [] })}
                />
              ),
              sortAccessor: (node) => modulePathLabelForDebugNode(node, moduleNodes),
              render: (node) => <span className="debug-node-module-path" title={modulePathLabelForDebugNode(node, moduleNodes)}>{modulePathLabelForDebugNode(node, moduleNodes) || "未分配模块"}</span>
            },
            {
              key: "bindings",
              header: "协议与节点路径",
              render: (node) => <div className="debug-node-binding-summary">
                {(["hdc", "adb"] as const).map((protocol) => {
                  const binding = bindingForProtocol(node.bindings, protocol);
                  const status = nodeBindingStatus(node.bindings, protocol);
                  return <div className="debug-node-binding-summary__row" key={protocol} data-state={status}>
                    <span className="debug-node-protocol">{protocol.toUpperCase()}</span>
                    <span className="debug-node-access">{status === "missing" ? "未配置" : status === "disabled" ? "已停用" : ({ RO: "只读", WO: "只写", RW: "读写" }[binding.accessMode])}</span>
                    {status !== "missing" ? <code title={binding.nodePath}>{binding.nodePath}</code> : null}
                  </div>;
                })}
              </div>
            },
            {
              key: "status",
              header: "状态",
              sortAccessor: (node) => (node.enabled ? 0 : 1),
              render: (node) => (
                <span className="debug-node-status" data-enabled={node.enabled}>
                  {node.enabled ? "启用" : "已禁用"}
                </span>
              )
            }
          ]
        }}
        filterBar={
          <div className="debug-node-catalog-filters">
            <SearchField
              value={search.q}
              onValueChange={(value) => onUpdateSearch({ q: value })}
              placeholder="搜索节点名称、模块、说明或路径"
              ariaLabel="搜索可调节点"
              disabled={loading}
            />
            <div className="debug-node-catalog-filter-actions">
              <LibrarySelectFilter
                ariaLabel="协议筛选"
                disabled={loading}
                options={PROTOCOL_OPTIONS}
                value={search.protocol}
                onChange={(protocol) => onUpdateSearch({ protocol })}
              />
              {filtersActive ? (
                <button aria-label="清除筛选" className="clear-filters" type="button" onClick={clearFilters}>
                  清除筛选
                </button>
              ) : null}
            </div>
            <span className="parameters-table-count">
              {filtered.length} / {nodes.length} 项
            </span>
          </div>
        }
        emptyState={{ message: loading ? "加载中…" : "没有匹配的节点。",
          actionLabel: !filtersActive && canEdit && onCreate ? "新增节点" : "清除筛选条件",
          onAction: !filtersActive && canEdit && !loading && onCreate ? onCreate : clearFilters }}
        rowActions={(node) => ({
          label: `${node.name} 操作`,
          primaryAction: { id: "edit", label: "编辑", disabled: !canEdit || loading, onSelect: () => onEdit(node.id) },
          items: [
            { id: "disable", label: "禁用", ariaLabel: `禁用 ${node.name}`, destructive: true,
              disabled: !canEdit || !node.enabled || loading, onRequestConfirmation: () => onDisable(node.id) },
            { id: "delete", label: "删除", ariaLabel: `删除 ${node.name}`, destructive: true,
              title: canEdit ? undefined : "缺少调试管理权限",
              disabled: !canEdit || loading, onRequestConfirmation: () => onDelete(node.id) }
          ]
        })}
      />
    </section>
  );
}
