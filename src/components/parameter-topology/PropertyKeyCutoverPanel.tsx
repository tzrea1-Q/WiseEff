import { useEffect, useState } from "react";

import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { ModalDialog } from "@/components/common/ModalDialog";
import type {
  PropertyKeyCutoverPreview,
  PropertyKeyCutoverRun,
  PropertyKeyCutoverStartBlocker,
} from "@/domain/parameter-topology/types";
import { presentError } from "@/infrastructure/http/presentError";

const NESTED_CONFIRM_BACKDROP = "param-admin-modal-backdrop param-admin-modal-backdrop--nested";

export type PropertyKeyCutoverActions = {
  preview: (input: { propertyKey: string }) => Promise<PropertyKeyCutoverPreview>;
  start: (input: { propertyKey: string; reason: string }) => Promise<PropertyKeyCutoverRun>;
  prepare: (input?: { reason?: string }) => Promise<PropertyKeyCutoverRun>;
  finalize: (input: { reason: string }) => Promise<PropertyKeyCutoverRun>;
  loadOpenRun?: () => Promise<PropertyKeyCutoverRun | null>;
};

export type PropertyKeyCutoverPanelProps = {
  currentKey: string;
  pending?: boolean;
  actions: PropertyKeyCutoverActions;
};

function blockerLabel(blocker: PropertyKeyCutoverStartBlocker) {
  if (blocker.code === "triple-collision") return "目标属性键已被占用";
  if (blocker.code === "open-version-cutover") return "该定义已有未完成的版本切换";
  return "该定义已有未完成的属性键切换";
}

function locationLabel(status: string) {
  switch (status) {
    case "would-rewrite":
      return "将改写源";
    case "already-new-key":
      return "源已是新键";
    case "missing-from-source":
      return "源中找不到旧键";
    case "no-occurrence":
      return "无对应出现";
    case "conflict":
      return "新旧键同时存在";
    default:
      return "待处理";
  }
}

function itemLabel(status: string) {
  switch (status) {
    case "ready":
      return "已暂存草稿";
    case "pending":
      return "待改写";
    case "incompatible":
      return "不兼容";
    case "skipped":
      return "已跳过";
    case "applied":
      return "已完成";
    default:
      return status;
  }
}

export function PropertyKeyCutoverPanel({
  currentKey,
  pending = false,
  actions,
}: PropertyKeyCutoverPanelProps) {
  const [nextKey, setNextKey] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<PropertyKeyCutoverPreview | null>(null);
  const [run, setRun] = useState<PropertyKeyCutoverRun | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const blocked = pending || busy;
  const blockers = run?.startBlockers ?? preview?.startBlockers ?? [];
  const canStart = Boolean(preview && preview.startBlockers.length === 0 && !run);
  const canPrepare = Boolean(run && run.status !== "finalized");
  const sourcesMoved =
    Boolean(run) &&
    preview?.toKey === run?.toKey &&
    (preview?.locations.every(
      (location) => location.status === "already-new-key" || location.status === "no-occurrence",
    ) ??
      false);
  const canFinalize = Boolean(run && run.status === "ready" && sourcesMoved);

  useEffect(() => {
    if (!actions.loadOpenRun) return undefined;
    let cancelled = false;
    void actions
      .loadOpenRun()
      .then((openRun) => {
        if (!cancelled && openRun) {
          setRun(openRun);
          setNextKey(openRun.toKey);
        }
      })
      .catch(() => {
        /* no open run */
      });
    return () => {
      cancelled = true;
    };
  }, [actions]);

  async function runAction(task: () => Promise<void>) {
    setLocalError(null);
    setBusy(true);
    try {
      await task();
    } catch (error) {
      setLocalError(presentError(error, "属性键切换失败，请重试。"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="param-admin-cutover-panel" data-testid="property-key-cutover">
      <p className="eyebrow">{PARAMETER_ADMIN_UI.propertyKeyCutoverTitle}</p>
      <p className="form-hint">{PARAMETER_ADMIN_UI.propertyKeyCutoverHint}</p>
      <p className="form-hint">当前键：{currentKey}</p>
      <label className="param-admin-confirm-field" htmlFor="pk-cutover-next-key">
        <span>{PARAMETER_ADMIN_UI.propertyKeyCutoverNextKey}</span>
        <input
          id="pk-cutover-next-key"
          value={nextKey}
          disabled={blocked || Boolean(run)}
          onChange={(event) => setNextKey(event.target.value)}
        />
      </label>
      <label className="param-admin-confirm-field" htmlFor="pk-cutover-reason">
        <span>{PARAMETER_ADMIN_UI.propertyKeyCutoverReason}</span>
        <input
          id="pk-cutover-reason"
          value={reason}
          disabled={blocked}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="dialog-actions">
        <button
          type="button"
          className="button subtle"
          disabled={blocked || !nextKey.trim()}
          title={!nextKey.trim() ? "请先填写新属性键" : undefined}
          onClick={() =>
            void runAction(async () => {
              setPreview(await actions.preview({ propertyKey: nextKey.trim() }));
            })
          }
        >
          {busy ? "处理中…" : PARAMETER_ADMIN_UI.propertyKeyCutoverPreview}
        </button>
        <button
          type="button"
          className="button subtle"
          disabled={blocked || !canStart || !reason.trim()}
          title={
            canStart && reason.trim()
              ? undefined
              : blockers.length > 0
                ? "预检存在阻挡，无法启动"
                : !preview
                  ? "请先完成预检"
                  : !reason.trim()
                    ? "请先填写原因"
                    : "作业已启动"
          }
          onClick={() =>
            void runAction(async () => {
              setRun(
                await actions.start({
                  propertyKey: nextKey.trim(),
                  reason: reason.trim(),
                }),
              );
            })
          }
        >
          {PARAMETER_ADMIN_UI.propertyKeyCutoverStart}
        </button>
        <button
          type="button"
          className="button subtle"
          disabled={blocked || !canPrepare}
          title={canPrepare ? undefined : "请先启动作业"}
          onClick={() =>
            void runAction(async () => {
              setRun(await actions.prepare({ reason: reason.trim() || undefined }));
            })
          }
        >
          {PARAMETER_ADMIN_UI.propertyKeyCutoverPrepare}
        </button>
        <button
          type="button"
          className="button subtle"
          disabled={blocked || !canFinalize}
          title={
            canFinalize
              ? undefined
              : "请先暂存草稿，在配置工作台合入现行源后再次预检，确认源已是新键"
          }
          onClick={() => setFinalizeOpen(true)}
        >
          {PARAMETER_ADMIN_UI.propertyKeyCutoverFinalize}
        </button>
      </div>
      {localError ? (
        <p className="form-error" role="alert">
          {localError}
        </p>
      ) : null}
      {blockers.length > 0 ? (
        <ul className="form-error" role="alert">
          {blockers.map((blocker) => (
            <li key={blocker.code}>{blockerLabel(blocker)}</li>
          ))}
        </ul>
      ) : null}
      {preview ? (
        <p className="form-hint">
          {preview.locations.length === 0
            ? "预检未发现需改写的源位置。"
            : `预检 ${preview.locations.length} 处：${preview.locations
                .map((location) => `${location.fileName ?? location.bindingId}（${locationLabel(location.status)}）`)
                .join("；")}`}
        </p>
      ) : null}
      {run ? (
        <p className="form-hint">
          {run.stagedSource ? PARAMETER_ADMIN_UI.propertyKeyCutoverStaged : null}
          {run.items.map((item) => `${item.fileName ?? item.bindingId}（${itemLabel(item.status)}）`).join("；")}
        </p>
      ) : null}

      {finalizeOpen ? (
        <ModalDialog
          open
          onDismiss={blocked ? undefined : () => setFinalizeOpen(false)}
          className="submission-dialog param-admin-confirm-dialog"
          backdropClassName={NESTED_CONFIRM_BACKDROP}
        >
          {({ titleId }) => (
            <>
              <div className="submission-dialog-head param-admin-editor-dialog-head">
                <div className="param-admin-editor-dialog-head-text">
                  <span className="eyebrow">{PARAMETER_ADMIN_UI.propertyKeyCutoverTitle}</span>
                  <h2 id={titleId}>确认完成切换</h2>
                  <p>仅在现行源已经是新键之后才会改目录三元组。不会自动合入文件草稿。</p>
                </div>
              </div>
              <div className="param-admin-confirm-dialog-body">
                <label className="param-admin-confirm-field" htmlFor="pk-cutover-finalize-reason">
                  <span>{PARAMETER_ADMIN_UI.propertyKeyCutoverReason}</span>
                  <input
                    id="pk-cutover-finalize-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
              </div>
              <div className="dialog-actions">
                <button type="button" className="button subtle" onClick={() => setFinalizeOpen(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={!reason.trim() || blocked}
                  onClick={() =>
                    void runAction(async () => {
                      setRun(await actions.finalize({ reason: reason.trim() }));
                      setFinalizeOpen(false);
                    })
                  }
                >
                  确认完成切换
                </button>
              </div>
            </>
          )}
        </ModalDialog>
      ) : null}
    </div>
  );
}
