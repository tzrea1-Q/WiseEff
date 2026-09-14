import { ModalDialog } from "@/components/common/ModalDialog";
import type {
  CatalogImportClassification,
  CatalogImportConflict,
  CatalogImportDifferenceDetail,
  CatalogImportPreview,
  CatalogImportWarning
} from "@/infrastructure/http/debuggingAdminClient";
import "./debug-catalog-import-dialog.css";

export type DebugNodeCatalogImportDialogProps = {
  open: boolean;
  fileName: string;
  preview: CatalogImportPreview | null;
  loading: boolean;
  submitting: boolean;
  error: string;
  /** A non-error advisory (for example an unknown submit outcome) that survives re-preview. */
  notice?: string;
  onCancel: () => void;
  onConfirm: () => void;
  onReloadPreview: () => void;
};

const classificationLabels: Record<CatalogImportClassification, string> = {
  created: "新增",
  updated: "更新",
  unchanged: "不变"
};

const conflictLabel = "冲突";

const conflictDescriptions: Record<string, string> = {
  "duplicate-module-path": "文件中出现重复的模块完整路径。",
  "dangling-module-parent": "模块声明的父级路径在目标组织与文件中都不存在。",
  "dangling-node-module": "节点声明的模块路径在目标组织与文件中都不存在。",
  "duplicate-source-id": "同一个源节点 ID 在文件中出现多次。",
  "source-id-name-path-mismatch": "源节点 ID 命中的目标节点与文件中的模块/名称路径不一致。",
  "id-and-name-path-match-different-targets": "源节点 ID 与模块/名称路径命中了不同的目标节点。",
  "duplicate-target-claim": "两个文件条目解析到同一个目标节点。",
  "duplicate-input-node": "文件中出现重复的节点输入。",
  "duplicate-binding-protocol": "同一节点重复声明了同一协议绑定。",
  "ambiguous-target-node": "目标组织中存在多个同模块同名的节点，无法唯一匹配。",
  "dangling-target-module-reference": "目标节点引用的模块不在本组织内。",
  "dangling-target-module-parent": "目标模块的父级引用无法解析。",
  "cyclic-target-module": "目标模块的父级链未到达组织根节点。",
  "orphan-target-binding": "目标绑定引用的节点不在本组织内。",
  "declared-count-mismatch": "文件声明的数量与实际包含的对象数量不一致。"
};

const warningDescriptions: Record<string, string> = {
  "target-binding-preserved": "文件中未包含该协议绑定，目标端已有绑定将被保留。",
  "archive-state-preserved": "该节点保留目标端当前的归档状态，如需变更请使用独立的归档/恢复操作。"
};

function describeConflict(conflict: CatalogImportConflict) {
  return conflictDescriptions[conflict.code] ?? conflict.message;
}

function describeWarning(warning: CatalogImportWarning) {
  return warningDescriptions[warning.code] ?? warning.message;
}

function classificationSummary(counts: Record<CatalogImportClassification, number>) {
  return `新增 ${counts.created}，更新 ${counts.updated}，不变 ${counts.unchanged}`;
}

function formatFieldValue(value: unknown) {
  if (value === null || value === undefined) {
    return "空";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (typeof value === "string") {
    return value === "" ? "空" : value;
  }
  return JSON.stringify(value);
}

const fieldLabels: Record<string, string> = {
  name: "名称",
  description: "简述",
  detailedDescription: "详细描述",
  writeFormatExample: "写入示例",
  writeFormatHint: "写入提示",
  valueKind: "值类型",
  valueFormat: "值格式",
  normalizationMode: "归一化方式",
  maxValueBytes: "最大字节数",
  enabled: "启用状态",
  archived: "归档状态",
  archiveReason: "归档原因",
  scope: "适用范围",
  sortOrder: "顺序",
  nodePath: "协议路径",
  accessMode: "访问模式",
  notes: "备注"
};

function detailSummary(detail: CatalogImportDifferenceDetail) {
  if (detail.fields.length === 0) {
    return detail.classification === "created" ? "新增对象" : "无字段差异";
  }
  return detail.fields
    .map((field) => {
      const label = fieldLabels[field.field] ?? field.field;
      return `${label}: ${formatFieldValue(field.before)} → ${formatFieldValue(field.after)}`;
    })
    .join("；");
}

function objectLabel(object: CatalogImportDifferenceDetail["object"]) {
  if (object === "module") return "模块";
  if (object === "binding") return "协议绑定";
  return "节点";
}

/**
 * Import preview dialog. It shows exactly what the server classified — created, updated,
 * unchanged and blocking conflicts — before anything is written, and the confirm action
 * carries the server digest so an unreviewed target change cannot be applied silently.
 */
export function DebugNodeCatalogImportDialog({
  open,
  fileName,
  preview,
  loading,
  submitting,
  error,
  notice = "",
  onCancel,
  onConfirm,
  onReloadPreview
}: DebugNodeCatalogImportDialogProps) {
  const canSubmit = Boolean(preview?.canSubmit && preview.previewDigest);
  const conflictCount = preview?.conflicts.length ?? 0;
  const countConflictCount = preview?.countConflicts.length ?? 0;

  return (
    <ModalDialog
      open={open}
      onDismiss={loading || submitting ? undefined : onCancel}
      className="confirm-dialog debug-catalog-import-dialog modal-card--lg"
      describedBy
    >
      {({ titleId, descriptionId }) => (
        <>
          <h2 id={titleId}>导入预览</h2>
          <p id={descriptionId}>
            文件 <code>{fileName || "未选择文件"}</code> 的合并预览。确认前不会写入节点库。
          </p>

          {notice ? (
            <p role="status" className="debug-catalog-import-dialog__notice">
              {notice}
            </p>
          ) : null}

          <div className="debug-catalog-import-dialog__body" aria-busy={loading || submitting}>
            {loading ? <p role="status">正在校验文件并计算差异…</p> : null}

            {!loading && preview ? (
              <>
                <dl className="debug-catalog-import-dialog__scope">
                  <div>
                    <dt>来源组织</dt>
                    <dd>
                      {preview.sourceOrganization?.organizationName ??
                        preview.sourceOrganization?.organizationId ??
                        "文件中未提供"}
                    </dd>
                  </div>
                  <div>
                    <dt>目标组织</dt>
                    <dd>{preview.targetOrganizationId}</dd>
                  </div>
                  <div>
                    <dt>格式版本</dt>
                    <dd>{preview.format}</dd>
                  </div>
                  <div>
                    <dt>文件内容</dt>
                    <dd>
                      模块 {preview.fileCounts.modules}，节点 {preview.fileCounts.nodes}，绑定{" "}
                      {preview.fileCounts.bindings}
                    </dd>
                  </div>
                </dl>

                <ul className="debug-catalog-import-dialog__counts" aria-label="导入分类统计">
                  <li data-classification="created">
                    <span>新增</span> {preview.nodes.created + preview.modules.created + preview.bindings.created}
                  </li>
                  <li data-classification="updated">
                    <span>更新</span> {preview.nodes.updated + preview.modules.updated + preview.bindings.updated}
                  </li>
                  <li data-classification="unchanged">
                    <span>不变</span> {preview.nodes.unchanged + preview.modules.unchanged + preview.bindings.unchanged}
                  </li>
                  <li data-classification="conflict">
                    <span>{conflictLabel}</span> {conflictCount + countConflictCount}
                  </li>
                </ul>
                <p className="debug-catalog-import-dialog__breakdown">
                  节点：{classificationSummary(preview.nodes)}；模块：{classificationSummary(preview.modules)}；绑定：
                  {classificationSummary(preview.bindings)}
                </p>

                {conflictCount > 0 || countConflictCount > 0 ? (
                  <section aria-label="阻断冲突" className="debug-catalog-import-dialog__conflicts">
                    <h3>阻断冲突（必须先解决）</h3>
                    <ul>
                      {[...preview.conflicts, ...preview.countConflicts].map((conflict) => (
                        <li key={`${conflict.code}-${conflict.location}`}>
                          <code>{conflict.location}</code> {describeConflict(conflict)}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {preview.warnings.length > 0 ? (
                  <section aria-label="提示" className="debug-catalog-import-dialog__warnings">
                    <h3>提示</h3>
                    <ul>
                      {preview.warnings.map((warning) => (
                        <li key={`${warning.code}-${warning.location}`}>
                          <code>{warning.location}</code> {describeWarning(warning)}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <section aria-label="差异明细">
                  <h3>差异明细</h3>
                  {preview.details.length === 0 ? (
                    <p>无需更新：文件内容与当前节点库一致。</p>
                  ) : (
                    <table>
                      <caption>逐对象差异</caption>
                      <thead>
                        <tr>
                          <th scope="col">对象</th>
                          <th scope="col">位置</th>
                          <th scope="col">分类</th>
                          <th scope="col">字段变化</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.details.map((detail) => (
                          <tr key={`${detail.object}-${detail.path}`}>
                            <td data-label="对象">{objectLabel(detail.object)}</td>
                            <td data-label="位置">
                              <code>{detail.path}</code>
                            </td>
                            <td data-label="分类">{classificationLabels[detail.classification]}</td>
                            <td data-label="字段变化">{detailSummary(detail)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {preview.detailsTruncated ? <p>差异明细已截断，仅显示前若干条。</p> : null}
                </section>
              </>
            ) : null}

            {!loading && error ? (
              <p role="alert" className="debug-catalog-import-dialog__error">
                {error}
              </p>
            ) : null}
          </div>

          <div className="dialog-actions">
            <button type="button" className="button subtle" onClick={onCancel} disabled={loading || submitting}>
              取消
            </button>
            {error ? (
              <button type="button" className="button subtle" onClick={onReloadPreview} disabled={loading || submitting}>
                重新预览
              </button>
            ) : null}
            <button
              type="button"
              className="button primary"
              onClick={onConfirm}
              disabled={!canSubmit || loading || submitting}
            >
              {submitting ? "正在导入…" : "确认导入"}
            </button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
