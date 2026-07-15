import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DtsStructuralNode,
  DtsStructuralProperty,
  DtsStructuredRepository,
  DtsStructuredSubmissionRound
} from "@/application/ports/DtsStructuredRepository";
import {
  aggregateLocalStructuredEdits,
  type ParameterSourceLookup
} from "@/application/parameters/structuredChangeSet";
import { DtsNodeTreeView } from "@/components/parameters/DtsNodeTreeView";
import { StructuredDiffView } from "@/components/parameters/StructuredDiffView";
import {
  StructuredValueEditor,
  type StructuredValueChange
} from "@/components/parameters/StructuredValueEditor";

/** Teaching mock file/version ids used when no selection is provided. */
export const DTS_TEACHING_FILE_ID = "file-teaching-dts";
export const DTS_TEACHING_VERSION_ID = "version-teaching-1";

export type DtsStructureBrowserPanelProps = {
  projectId: string;
  repository: DtsStructuredRepository;
  fileId?: string;
  versionId?: string;
  /** When false, the value editor and submit entry are disabled. */
  canEdit?: boolean;
  /** When false, critical nodes (regulator/thermal path) disable the value editor. */
  canEditCritical?: boolean;
  /** Optional source bindings so the local change-set can map to real parameter ids. */
  parameterSources?: ParameterSourceLookup[];
};

type LocalPropertyDraft = {
  rawText: string;
  normalizedValue: string;
  present?: boolean;
};

function propertyKey(nodePath: string, propertyName: string) {
  return `${nodePath}::${propertyName}`;
}

export function isCriticalDtsNodePath(nodePath: string): boolean {
  const lower = nodePath.toLocaleLowerCase();
  return lower.includes("regulator") || lower.includes("thermal");
}

export function DtsStructureBrowserPanel({
  projectId,
  repository,
  fileId,
  versionId,
  canEdit = true,
  canEditCritical = true,
  parameterSources = []
}: DtsStructureBrowserPanelProps) {
  const [nodes, setNodes] = useState<DtsStructuralNode[]>([]);
  const [selectedNodePath, setSelectedNodePath] = useState<string | undefined>();
  const [selectedPropertyName, setSelectedPropertyName] = useState<string | undefined>();
  const [drafts, setDrafts] = useState<Record<string, LocalPropertyDraft>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitResult, setSubmitResult] = useState<DtsStructuredSubmissionRound | null>(null);
  const [loadedWith, setLoadedWith] = useState<{ fileId: string; versionId: string } | null>(null);

  const loadStructure = useCallback(
    async (nextFileId: string, nextVersionId: string) => {
      setLoading(true);
      setError("");
      setSubmitResult(null);
      try {
        const result = await repository.getStructure(projectId, nextFileId, nextVersionId);
        setNodes(result.nodes);
        setLoadedWith({ fileId: nextFileId, versionId: nextVersionId });
        setSelectedNodePath((current) => {
          if (current && result.nodes.some((item) => item.nodePath === current)) {
            return current;
          }
          return result.nodes[0]?.nodePath;
        });
        setSelectedPropertyName(undefined);
        setDrafts({});
      } catch (loadError) {
        setNodes([]);
        setError(loadError instanceof Error ? loadError.message : "结构加载失败。");
      } finally {
        setLoading(false);
      }
    },
    [projectId, repository]
  );

  useEffect(() => {
    const initialFileId = fileId ?? DTS_TEACHING_FILE_ID;
    const initialVersionId = versionId ?? DTS_TEACHING_VERSION_ID;
    void loadStructure(initialFileId, initialVersionId);
  }, [fileId, loadStructure, versionId]);

  const selectedNode = useMemo(
    () => nodes.find((item) => item.nodePath === selectedNodePath) ?? null,
    [nodes, selectedNodePath]
  );

  const selectedProperty: DtsStructuralProperty | null = useMemo(() => {
    if (!selectedNode || !selectedPropertyName) {
      return null;
    }
    return selectedNode.properties.find((property) => property.name === selectedPropertyName) ?? null;
  }, [selectedNode, selectedPropertyName]);

  const availableLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const item of nodes) {
      for (const label of item.labels) {
        labels.add(label);
      }
    }
    return Array.from(labels);
  }, [nodes]);

  const criticalLocked =
    Boolean(selectedNode) && !canEditCritical && isCriticalDtsNodePath(selectedNode!.nodePath);
  const editorLocked = !canEdit || criticalLocked;

  const activeDraft =
    selectedNode && selectedProperty
      ? drafts[propertyKey(selectedNode.nodePath, selectedProperty.name)]
      : undefined;

  const editorRawText = activeDraft?.rawText ?? selectedProperty?.rawText ?? "";
  const editorNormalized = activeDraft?.normalizedValue ?? selectedProperty?.normalizedValue ?? "";
  const editorPresent = activeDraft?.present;

  const onEditorChange = (next: StructuredValueChange) => {
    if (!selectedNode || !selectedProperty || editorLocked) {
      return;
    }
    const key = propertyKey(selectedNode.nodePath, selectedProperty.name);
    setDrafts((current) => ({
      ...current,
      [key]: {
        rawText: next.rawText,
        normalizedValue: next.normalizedValue,
        ...(typeof next.present === "boolean" ? { present: next.present } : {})
      }
    }));
    setSubmitResult(null);
  };

  const localAggregate = useMemo(() => {
    if (!loadedWith) {
      return null;
    }
    const draftRows = [];
    for (const node of nodes) {
      for (const property of node.properties) {
        const draft = drafts[propertyKey(node.nodePath, property.name)];
        if (!draft) continue;
        draftRows.push({
          nodePath: node.nodePath,
          propertyName: property.name,
          beforeRawText: property.rawText,
          rawText: draft.rawText,
          normalizedValue: draft.normalizedValue
        });
      }
    }
    return aggregateLocalStructuredEdits({
      fileId: loadedWith.fileId,
      fileName: loadedWith.fileId === DTS_TEACHING_FILE_ID ? "teaching-sample.dts" : loadedWith.fileId,
      drafts: draftRows,
      parameters: parameterSources
    });
  }, [drafts, loadedWith, nodes, parameterSources]);

  const submitChangeRequest = async () => {
    if (!localAggregate || localAggregate.edits.length === 0 || !canEdit) {
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const round = await repository.submitStructuredEdits(projectId, {
        edits: localAggregate.edits,
        reason: "Structured DTS edits from structure browser"
      });
      setSubmitResult(round);
      setDrafts({});
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交变更请求失败。");
    } finally {
      setSubmitting(false);
    }
  };

  const compareResultForDiff = localAggregate
    ? {
        baselineId: localAggregate.changeSet.baselineId,
        members: [
          {
            fileId: loadedWith?.fileId ?? "local",
            fileName:
              loadedWith?.fileId === DTS_TEACHING_FILE_ID ? "teaching-sample.dts" : loadedWith?.fileId,
            status: "version_changed" as const,
            structuralDiff: localAggregate.changeSet.changes.map((entry) => entry.change)
          }
        ]
      }
    : null;

  return (
    <section className="dts-structure-browser-panel" aria-label="结构浏览">
      <div className="dts-structure-browser-panel__head">
        <div>
          <h3>结构浏览</h3>
          <p>浏览节点树、编辑结构化属性值，聚成变更集后提交为变更请求（回写载荷使用 rawText）。</p>
        </div>
        <button
          type="button"
          className="button subtle"
          disabled={loading}
          onClick={() => void loadStructure(DTS_TEACHING_FILE_ID, DTS_TEACHING_VERSION_ID)}
        >
          加载教学结构
        </button>
      </div>

      {loading ? <p className="dts-structure-browser-panel__status">结构加载中…</p> : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && nodes.length === 0 ? (
        <p className="dts-structure-browser-panel__empty">
          暂无结构节点。可点击「加载教学结构」拉取 mock 教学样例
          {loadedWith ? `（上次：${loadedWith.fileId} / ${loadedWith.versionId}）` : ""}。
        </p>
      ) : null}

      {nodes.length > 0 ? (
        <div className="dts-structure-browser-panel__body">
          <DtsNodeTreeView
            nodes={nodes}
            selectedNodePath={selectedNodePath}
            onSelectNode={(nodePath) => {
              setSelectedNodePath(nodePath);
              setSelectedPropertyName(undefined);
            }}
          />

          <div className="dts-structure-browser-panel__detail" aria-label="节点属性">
            {selectedNode ? (
              <>
                <h4>
                  <code>{selectedNode.nodePath}</code>
                </h4>
                {isCriticalDtsNodePath(selectedNode.nodePath) ? (
                  <p className="dts-structure-browser-panel__risk-note" role="note">
                    安全关键节点（regulator / thermal）
                  </p>
                ) : null}
                <ul className="dts-structure-browser-panel__properties">
                  {selectedNode.properties.map((property) => {
                    const key = propertyKey(selectedNode.nodePath, property.name);
                    const draft = drafts[key];
                    const active = selectedPropertyName === property.name;
                    return (
                      <li key={property.name}>
                        <button
                          type="button"
                          className={`dts-structure-browser-panel__property${active ? " is-active" : ""}`}
                          aria-label={`编辑属性 ${property.name}`}
                          aria-pressed={active}
                          onClick={() => setSelectedPropertyName(property.name)}
                        >
                          <strong>{property.name}</strong>
                          <span>
                            {property.valueType}
                            {" · "}
                            {draft?.normalizedValue ?? property.normalizedValue}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {selectedNode.properties.length === 0 ? (
                  <p className="dts-structure-browser-panel__empty">该节点无属性。</p>
                ) : null}
              </>
            ) : (
              <p className="dts-structure-browser-panel__empty">选择左侧节点以查看属性。</p>
            )}

            {selectedProperty ? (
              <div className="dts-structure-browser-panel__editor" aria-label="属性值编辑">
                <h4>编辑 · {selectedProperty.name}</h4>
                {!canEdit ? (
                  <p className="field-error" role="alert">
                    需要 parameter:edit 权限才能编辑结构化属性。
                  </p>
                ) : null}
                {criticalLocked ? (
                  <p className="field-error" role="alert">
                    需要 parameter:edit-critical 权限才能编辑安全关键节点。
                  </p>
                ) : null}
                <StructuredValueEditor
                  propertyName={selectedProperty.name}
                  valueType={selectedProperty.valueType}
                  rawText={editorRawText}
                  present={editorPresent}
                  availableLabels={availableLabels}
                  disabled={editorLocked || selectedProperty.valueType === "empty"}
                  onChange={onEditorChange}
                />
                <p className="dts-structure-browser-panel__preview-note">
                  本地预览规范化值：<code>{editorNormalized}</code>
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {canEdit && localAggregate && localAggregate.edits.length > 0 && compareResultForDiff ? (
        <div className="dts-structure-browser-panel__changeset">
          <StructuredDiffView result={compareResultForDiff} changeSet={localAggregate.changeSet} />
          <p>
            待提交 {localAggregate.edits.length} 项 · 已映射 {localAggregate.changeSet.items.length} 项 ·
            未映射 {localAggregate.changeSet.unmapped.length} 项
          </p>
          <button
            type="button"
            className="button"
            disabled={submitting}
            onClick={() => void submitChangeRequest()}
          >
            提交变更请求
          </button>
        </div>
      ) : null}

      {submitResult ? (
        <p className="dts-structure-browser-panel__submit-success" role="status">
          已提交变更请求 <code>{submitResult.id}</code>
          {submitResult.items.map((item) => (
            <span key={item.parameterId}>
              {" · "}
              <code>{item.parameterId}</code>
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}
