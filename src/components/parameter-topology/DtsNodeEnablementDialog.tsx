import { useEffect, useId, useState } from "react";
import { CircleX } from "lucide-react";

import { ModalDialog } from "@/components/common/ModalDialog";
import type { EnablementEditTarget } from "@/domain/parameter-topology/enablementEdit";
import type { TopologyNodeEnablement } from "@/domain/parameter-topology/types";
import { formatDtsRawValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type NodeEnablementView = TopologyNodeEnablement;

export type DtsNodeEnablementDialogProps = {
  open: boolean;
  nodeLabel: string;
  enablement: NodeEnablementView;
  measuredSpelling: "ok" | "okay";
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (input: {
    target: EnablementEditTarget;
    reason: string;
    acknowledgeNonstandard?: boolean;
    spellingOverride?: "ok" | "okay";
  }) => Promise<void>;
};

function enablementPositionLabel(enablement: NodeEnablementView): string {
  if (enablement.override === "nonstandard") {
    return `非标准（${enablement.rawToken ?? enablement.rawStatus ?? "?"}）`;
  }
  if (enablement.override === "force-disabled") return "已禁用";
  if (enablement.override === "force-enabled") return "已启用";
  return "未声明（缺省启用）";
}

function formatStatusDisplay(raw: string | null): string {
  if (raw == null || !raw.trim()) return "未声明";
  return formatDtsRawValueForUi(raw) || raw;
}

export function DtsNodeEnablementDialog({
  open,
  nodeLabel,
  enablement,
  measuredSpelling,
  busy = false,
  error = null,
  onClose,
  onConfirm
}: DtsNodeEnablementDialogProps) {
  const reasonId = useId();
  const disableConfirmId = useId();
  const nonstandardAckId = useId();
  const spellingId = useId();
  const isNonstandard = enablement.override === "nonstandard";
  const [nonstandardRevealed, setNonstandardRevealed] = useState(false);
  const [target, setTarget] = useState<"force-enabled" | "force-disabled">(
    enablement.selfEnabled ? "force-enabled" : "force-disabled"
  );
  const [reason, setReason] = useState("");
  const [disableConfirmed, setDisableConfirmed] = useState(false);
  const [acknowledgeNonstandard, setAcknowledgeNonstandard] = useState(false);
  const [spellingOverride, setSpellingOverride] = useState<"ok" | "okay">(measuredSpelling);

  useEffect(() => {
    if (!open) return;
    setNonstandardRevealed(false);
    setTarget(enablement.selfEnabled ? "force-enabled" : "force-disabled");
    setReason("");
    setDisableConfirmed(false);
    setAcknowledgeNonstandard(false);
    setSpellingOverride(measuredSpelling);
  }, [enablement.selfEnabled, measuredSpelling, nodeLabel, open]);

  const showEditForm = !isNonstandard || nonstandardRevealed;
  const reasonReady = reason.trim().length > 0;
  const disableReady = target !== "force-disabled" || (reasonReady && disableConfirmed);
  const nonstandardReady = !isNonstandard || !nonstandardRevealed || (acknowledgeNonstandard && reasonReady);
  const canConfirm = showEditForm && disableReady && nonstandardReady && !busy;

  const submitTarget = (nextTarget: EnablementEditTarget) => {
    if (!canConfirm && nextTarget !== "unstated") return;
    void onConfirm({
      target: nextTarget,
      reason: reason.trim(),
      acknowledgeNonstandard: isNonstandard && nonstandardRevealed ? acknowledgeNonstandard : undefined,
      spellingOverride: nextTarget === "force-enabled" ? spellingOverride : undefined
    });
  };

  return (
    <ModalDialog
      open={open}
      onDismiss={busy ? undefined : onClose}
      className="dts-node-enablement-dialog"
      backdropClassName="dts-node-enablement-dialog__overlay"
      describedBy
    >
      {({ titleId, descriptionId }) => (
        <>
        <header className="dts-node-enablement-dialog__header">
          <div>
            <h2 id={titleId}>节点启用状态</h2>
            <p id={descriptionId} className="dts-node-enablement-dialog__description">
              修改 <code>{nodeLabel}</code> 的 <code>status</code> 属性；变更将加入本轮草稿。
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
          >
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </header>

        <div className="dts-node-enablement-dialog__content grid gap-3">
          <section className="dts-node-enablement-dialog__summary" aria-label="当前状态">
            <div>
              <strong>当前状态</strong>
              <p>
                {enablementPositionLabel(enablement)}
                {enablement.rawStatus ? (
                  <span>
                    {" "}
                    · <code>{formatStatusDisplay(enablement.rawStatus)}</code>
                  </span>
                ) : null}
              </p>
              {!enablement.reachable && enablement.blockingAncestorLabel ? (
                <p className="dts-node-enablement-dialog__blocked" role="status">
                  不可达：阻断于 {enablement.blockingAncestorLabel}
                </p>
              ) : null}
            </div>
          </section>

          {isNonstandard && !nonstandardRevealed ? (
            <section
              className="dts-node-enablement-dialog__panel"
              role="region"
              aria-label="非标准 status"
            >
              <strong>非标准取值</strong>
              <p>
                该节点使用非标准取值，不能直接切换启停。原文保留为只读；如需覆盖须明确确认并说明理由。
              </p>
              <p className="dts-node-enablement-dialog__raw">
                <code>{formatStatusDisplay(enablement.rawStatus)}</code>
              </p>
              <div className="dts-node-enablement-dialog__panel-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setNonstandardRevealed(true)}
                >
                  仍要修改
                </Button>
              </div>
            </section>
          ) : null}

          {showEditForm ? (
            <section className="dts-node-enablement-dialog__panel" aria-label="启用状态编辑">
              <fieldset className="dts-node-enablement-dialog__positions" disabled={busy}>
                <legend>目标状态</legend>
                <div className="dts-node-enablement-dialog__choice-row" role="presentation">
                  <label
                    className={[
                      "dts-node-enablement-dialog__choice",
                      target === "force-enabled" ? "is-selected" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <input
                      type="radio"
                      name="enablement-target"
                      checked={target === "force-enabled"}
                      onChange={() => setTarget("force-enabled")}
                    />
                    <span>启用</span>
                  </label>
                  <label
                    className={[
                      "dts-node-enablement-dialog__choice",
                      target === "force-disabled" ? "is-selected" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <input
                      type="radio"
                      name="enablement-target"
                      checked={target === "force-disabled"}
                      onChange={() => setTarget("force-disabled")}
                    />
                    <span>禁用</span>
                  </label>
                </div>
              </fieldset>

              {target === "force-enabled" ? (
                <div className="dts-node-enablement-dialog__field">
                  <Label htmlFor={spellingId}>写入拼写</Label>
                  <p className="dts-node-enablement-dialog__hint">
                    项目实测习惯为 <code>{measuredSpelling}</code>
                  </p>
                  <select
                    id={spellingId}
                    aria-label="status 拼写"
                    value={spellingOverride}
                    disabled={busy}
                    onChange={(event) => setSpellingOverride(event.target.value as "ok" | "okay")}
                  >
                    <option value="ok">ok</option>
                    <option value="okay">okay</option>
                  </select>
                </div>
              ) : null}

              <div className="dts-node-enablement-dialog__field">
                <Label htmlFor={reasonId}>修改原因</Label>
                <Textarea
                  id={reasonId}
                  aria-label="修改原因"
                  value={reason}
                  disabled={busy}
                  rows={3}
                  placeholder={
                    target === "force-disabled" ? "说明为何禁用此节点" : "说明为何修改节点启用状态"
                  }
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>

              {target === "force-disabled" ? (
                <label className="dts-node-enablement-dialog__confirm" htmlFor={disableConfirmId}>
                  <input
                    id={disableConfirmId}
                    type="checkbox"
                    checked={disableConfirmed}
                    disabled={busy}
                    onChange={(event) => setDisableConfirmed(event.target.checked)}
                  />
                  <span>我确认要禁用此节点</span>
                </label>
              ) : null}

              {isNonstandard && nonstandardRevealed ? (
                <label className="dts-node-enablement-dialog__confirm" htmlFor={nonstandardAckId}>
                  <input
                    id={nonstandardAckId}
                    type="checkbox"
                    checked={acknowledgeNonstandard}
                    disabled={busy}
                    onChange={(event) => setAcknowledgeNonstandard(event.target.checked)}
                  />
                  <span>我了解将覆盖非标准 status 原文</span>
                </label>
              ) : null}
            </section>
          ) : null}

          {error ? (
            <p className="dts-node-enablement-dialog__error form-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="dts-node-enablement-dialog__footer">
          {showEditForm ? (
            <Button
              type="button"
              variant="ghost"
              className="dts-node-enablement-dialog__unstated"
              disabled={busy || !reasonReady}
              onClick={() => void submitTarget("unstated")}
            >
              恢复未声明
            </Button>
          ) : null}
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            取消
          </Button>
          {showEditForm ? (
            <Button type="button" disabled={!canConfirm} onClick={() => void submitTarget(target)}>
              {busy ? "校验中…" : "校验并加入本轮"}
            </Button>
          ) : null}
        </footer>
        </>
      )}
    </ModalDialog>
  );
}
