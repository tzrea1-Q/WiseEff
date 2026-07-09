import { Search } from "lucide-react";
import { nodeBindingStatus } from "@/debugAdminDraft";
import { filterDebugNodesByModuleTree, modulePathLabelForDebugNode } from "@/debugAdminModules";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import type { DebugConnectionProtocol, DebugNodeRegistryEntry } from "@/domain/debugging/types";

export type DebugNodeLibrarySearch = {
  q: string;
  protocol: "all" | DebugConnectionProtocol;
  modules: string[];
  sort: "name-asc" | string;
};

const PROTOCOL_OPTIONS: Array<{ value: DebugNodeLibrarySearch["protocol"]; label: string }> = [
  { value: "all", label: "全部" },
  { value: "hdc", label: "HDC" },
  { value: "adb", label: "ADB" }
];

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

function sortNodes(nodes: DebugNodeRegistryEntry[], sort: DebugNodeLibrarySearch["sort"]) {
  const sorted = [...nodes];
  if (sort === "name-asc") {
    sorted.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }
  return sorted;
}

export type DebugNodeLibraryTableProps = {
  nodes: readonly DebugNodeRegistryEntry[];
  moduleNodes: readonly FlatModuleNode[];
  search: DebugNodeLibrarySearch;
  onUpdateSearch: (patch: Partial<DebugNodeLibrarySearch>) => void;
  onEdit: (nodeId: string) => void;
  onEditBindings: (nodeId: string) => void;
  onDisable: (nodeId: string) => void;
  onCreate?: () => void;
  onManageModules?: () => void;
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
  onCreate,
  onManageModules,
  canEdit = true,
  loading = false
}: DebugNodeLibraryTableProps) {
  const filtered = sortNodes(filterNodes(nodes, search, moduleNodes), search.sort);
  const filtersActive = search.q.trim().length > 0 || search.protocol !== "all" || search.modules.length > 0;

  const clearFilters = () => {
    onUpdateSearch({
      q: "",
      protocol: "all",
      modules: []
    });
  };

  return (
    <section className="parameters-table param-admin-library-table" aria-label="可调节点目录">
      <div className="parameters-table-heading">
        <div>
          <h2>可调节点目录</h2>
          <p>维护节点调试可调用的设备节点路径，通过操作列编辑元数据或配置 HDC / ADB 路径绑定。</p>
        </div>
        <div className="param-admin-library-heading-actions">
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
          <select
            aria-label="协议筛选"
            className="library-sort"
            value={search.protocol}
            onChange={(event) => onUpdateSearch({ protocol: event.target.value as DebugNodeLibrarySearch["protocol"] })}
            disabled={loading}
          >
            {PROTOCOL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                协议 · {option.label}
              </option>
            ))}
          </select>
          <ModuleTreeSelect
            label="模块"
            mode="multi-filter"
            nodes={moduleNodes}
            value={search.modules}
            onChange={(modules) => onUpdateSearch({ modules: typeof modules === "string" ? [modules] : modules })}
            disabled={loading}
          />
          <select
            aria-label="排序"
            className="library-sort"
            value={search.sort}
            onChange={(event) => onUpdateSearch({ sort: event.target.value })}
            disabled={loading}
          >
            <option value="name-asc">名称 A-Z</option>
          </select>
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

      <div className="parameters-table-scroll">
        <table className="parameters-table-grid debug-admin-library-grid debug-admin-node-library-grid" aria-label="可调节点目录">
          <colgroup>
            <col className="debug-admin-col-index" />
            <col className="debug-admin-col-name" />
            <col className="debug-admin-col-module" />
            <col className="debug-admin-col-format" />
            <col className="debug-admin-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">节点名</th>
              <th scope="col">模块</th>
              <th scope="col">状态</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5}>加载中…</td>
              </tr>
            ) : (
              filtered.map((node, index) => {
                const rowDisabled = !canEdit || !node.enabled;
                return (
                  <tr key={node.id}>
                    <td data-label="#">{index + 1}</td>
                    <td data-label="节点名">
                      <strong>{node.name}</strong>
                      {node.description ? <small>{node.description}</small> : null}
                    </td>
                    <td data-label="模块">{modulePathLabelForDebugNode(node, moduleNodes) || "—"}</td>
                    <td data-label="状态">
                      <span className={`debug-admin-coverage-badge${node.enabled ? "" : " disabled"}`}>
                        {node.enabled ? "启用" : "已禁用"}
                      </span>
                    </td>
                    <td data-label="操作">
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
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && filtered.length === 0 ? (
        <div className="parameters-table-empty">
          <p>没有匹配的节点。</p>
          {filtersActive ? (
            <button type="button" className="button subtle" onClick={clearFilters}>
              清除筛选条件
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
