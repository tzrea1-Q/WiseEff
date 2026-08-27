import { Search } from "lucide-react";
import { useMemo } from "react";
import { buildParameterModuleFilterNodes } from "@/application/parameters/buildModuleFilterNodes";
import { DataTable, type DataTableSort } from "@/components/admin/DataTable";
import { LibrarySelectFilter } from "@/components/admin/LibrarySelectFilter";
import { ColumnFilter } from "@/components/ColumnFilter";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import type { DebugConnectionProtocol, DebugNodeRegistryEntry } from "@/domain/debugging/types";
import { nodeBindingStatus } from "@/debugAdminDraft";
import { debugNodeModuleId, filterDebugNodesByModuleTree, modulePathLabelForDebugNode } from "@/debugAdminModules";
import "./debug-admin-library-table.css";

export type DebugNodeLibrarySearch = {
  q: string;
  protocol: "all" | DebugConnectionProtocol;
  modules: string[];
  sort: "name-asc" | string;
};

const PROTOCOL_OPTIONS: Array<{ value: DebugNodeLibrarySearch["protocol"]; label: string }> = [
  { value: "all", label: "协议 · 全部" },
  { value: "hdc", label: "协议 · HDC" },
  { value: "adb", label: "协议 · ADB" }
];

const LIBRARY_PAGE_SIZE = 50;

function nodeSearchHaystack(node: DebugNodeRegistryEntry) {
  const bindingPaths = (node.bindings ?? []).map((binding) => binding.nodePath).join(" ");
  return `${node.name} ${node.description} ${node.detailedDescription} ${node.module} ${bindingPaths}`.toLowerCase();
}

function filterNodes(
  nodes: readonly DebugNodeRegistryEntry[],
  search: DebugNodeLibrarySearch,
  moduleNodes: readonly FlatModuleNode[]
) {
  const byModule = filterDebugNodesByModuleTree(nodes, moduleNodes, search.modules);

  return byModule.filter((node) => {
    if (search.q.trim()) {
      const needle = search.q.trim().toLowerCase();
      if (!nodeSearchHaystack(node).includes(needle)) {
        return false;
      }
    }

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
  onEditBindings: (nodeId: string) => void;
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
  onEditBindings,
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
        moduleId: debugNodeModuleId(node),
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
    <section className="parameters-table param-admin-library-table debug-admin-library-table" aria-label="可调节点目录">
      <div className="parameters-table-heading">
        <div>
          <h2>可调节点目录</h2>
          <p>维护节点调试可调用的设备节点路径，通过操作列编辑元数据或配置 HDC / ADB 路径绑定。</p>
        </div>
        <div className="param-admin-library-heading-actions">
          {onExport ? (
            <button
              className="button subtle"
              type="button"
              onClick={onExport}
              disabled={!canEdit || loading}
              title={canEdit ? undefined : "缺少 debugging:admin 权限"}
            >
              导出目录
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
              导入目录
            </button>
          ) : null}
          {onManageModules ? (
            <button className="button subtle" type="button" onClick={onManageModules} disabled={loading}>
              模块管理
            </button>
          ) : null}
          {onCreate ? (
            <button className="button subtle" type="button" onClick={onCreate} disabled={!canEdit || loading}>
              新增节点
            </button>
          ) : null}
        </div>
      </div>

      <DataTable
        aria-label="可调节点目录"
        className="debug-admin-library-datatable"
        rows={loading ? [] : filtered}
        rowKey={(node) => node.id}
        pageSize={LIBRARY_PAGE_SIZE}
        sort={tableSort}
        onSort={(key) => {
          const nextDirection = tableSort.key === key && tableSort.direction === "asc" ? "desc" : "asc";
          onUpdateSearch({ sort: `${key}-${nextDirection}` });
        }}
        onRowClick={canEdit && !loading ? (node) => onEdit(node.id) : undefined}
        emptyState={
          loading ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground">没有匹配的节点。</p>
              {filtersActive ? (
                <button type="button" className="button subtle" onClick={clearFilters}>
                  清除筛选条件
                </button>
              ) : null}
            </div>
          )
        }
        toolbar={
          <div className="parameters-table-toolbar">
            <label className="parameters-table-search">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label="搜索可调节点"
                type="search"
                value={search.q}
                onChange={(event) => onUpdateSearch({ q: event.target.value })}
                placeholder="搜索节点名称、模块、说明或路径"
                disabled={loading}
              />
            </label>
            <div className="parameters-table-filters param-admin-library-filters">
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
        columns={[
          {
            key: "name",
            header: "节点名",
            sortAccessor: (node) => node.name,
            render: (node) => (
              <div className="debug-admin-library-name">
                <strong>{node.name}</strong>
                {node.description ? <small>{node.description}</small> : null}
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
            render: (node) => modulePathLabelForDebugNode(node, moduleNodes) || "—"
          },
          {
            key: "status",
            header: "状态",
            sortAccessor: (node) => (node.enabled ? 0 : 1),
            render: (node) => (
              <span className={`debug-admin-coverage-badge${node.enabled ? "" : " disabled"}`}>
                {node.enabled ? "启用" : "已禁用"}
              </span>
            )
          }
        ]}
        renderRowActions={(node) => {
          const rowDisabled = !canEdit || !node.enabled;
          return (
            <div className="param-admin-row-actions">
              <button
                type="button"
                className="button subtle param-admin-row-action"
                disabled={!canEdit || loading}
                onClick={() => onEdit(node.id)}
              >
                编辑
              </button>
              <button
                type="button"
                className="button subtle param-admin-row-action"
                disabled={!canEdit || loading}
                onClick={() => onEditBindings(node.id)}
              >
                路径绑定
              </button>
              <button
                type="button"
                className="button danger param-admin-row-action"
                disabled={rowDisabled || loading}
                aria-label={`禁用 ${node.name}`}
                onClick={() => onDisable(node.id)}
              >
                禁用
              </button>
              <button
                type="button"
                className="button danger param-admin-row-action"
                disabled={!canEdit || loading}
                aria-label={`删除 ${node.name}`}
                title={canEdit ? undefined : "缺少调试管理权限"}
                onClick={() => onDelete(node.id)}
              >
                删除
              </button>
            </div>
          );
        }}
      />
    </section>
  );
}
