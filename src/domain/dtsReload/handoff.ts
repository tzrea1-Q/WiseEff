/**
 * Workbench → `/dts-reload` hand-off (TD-064).
 *
 * Query convention matches existing camelCase deep links (`runId`):
 * `/dts-reload?project=<id>&bindingIds=<id1,id2>`.
 * The session's run-id seam continues to use `run` / `runId` independently.
 */

export const DTS_RELOAD_HANDOFF_PROJECT_PARAM = "project";
export const DTS_RELOAD_HANDOFF_BINDING_IDS_PARAM = "bindingIds";

export type DtsReloadHandoffQuery = {
  projectId: string | null;
  bindingIds: string[];
};

export function parseDtsReloadHandoffQuery(
  search: string | URLSearchParams
): DtsReloadHandoffQuery {
  const params = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search) : search;
  const projectId = params.get(DTS_RELOAD_HANDOFF_PROJECT_PARAM)?.trim() || null;
  const bindingIds = uniqueBindingIds(
    (params.get(DTS_RELOAD_HANDOFF_BINDING_IDS_PARAM) ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  );
  return { projectId, bindingIds };
}

export function buildDtsReloadHandoffPath(input: {
  projectId: string;
  bindingIds: readonly string[];
}): string {
  const params = new URLSearchParams();
  params.set(DTS_RELOAD_HANDOFF_PROJECT_PARAM, input.projectId);
  const bindingIds = uniqueBindingIds(input.bindingIds);
  if (bindingIds.length > 0) {
    params.set(DTS_RELOAD_HANDOFF_BINDING_IDS_PARAM, bindingIds.join(","));
  }
  return `/dts-reload?${params.toString()}`;
}

export type WorkbenchReloadHandoffResolution =
  | { ok: true; bindingIds: string[]; source: "draft-selection" | "visible-filter" }
  | { ok: false; disabledReason: string };

/**
 * Resolve which binding ids the workbench should carry into parameter debugging.
 * Draft checkboxes win; otherwise the current search/module/navigator narrowing.
 * Never invent a full-table dump. Row highlighting is not a source: it only exists
 * while the detail dialog is open, which covers the toolbar CTA.
 */
export function resolveWorkbenchReloadHandoff(input: {
  projectId?: string | null;
  selectedDraftBindingIds: ReadonlySet<string> | readonly string[];
  visibleBindingIds: readonly string[];
  totalRowCount: number;
}): WorkbenchReloadHandoffResolution {
  if (!input.projectId?.trim()) {
    return { ok: false, disabledReason: "缺少项目，无法带到参数调试" };
  }

  const draftIds = uniqueBindingIds(input.selectedDraftBindingIds);
  if (draftIds.length > 0) {
    return { ok: true, bindingIds: draftIds, source: "draft-selection" };
  }

  if (input.visibleBindingIds.length === 0) {
    return { ok: false, disabledReason: "当前筛选没有可带入的参数" };
  }

  if (input.visibleBindingIds.length < input.totalRowCount) {
    return { ok: true, bindingIds: uniqueBindingIds(input.visibleBindingIds), source: "visible-filter" };
  }

  return {
    ok: false,
    disabledReason: "请先勾选草稿，或用搜索/模块筛选缩小结果"
  };
}

function uniqueBindingIds(ids: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
