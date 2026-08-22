import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { XiaozeInterruptPayload } from "@wiseeff/xiaoze-protocol";

export type XiaozeApprovalResolveValue = {
  decision: "approve" | "reject";
  editedArgs?: Record<string, unknown>;
  reason?: string;
};

export const XIAOZE_APPROVAL_DEFAULT_REJECT_REASON = "在小泽对话中被拒绝";
/**
 * Approval card for the draft-only knowledge tool: shows what the draft will
 * contain (editable title, tags, source, content preview) and reminds the
 * reviewer that approving only creates a DRAFT a human still has to publish.
 */
function KnowledgeDraftApprovalContent({
  interrupt,
  resolve
}: {
  interrupt: XiaozeInterruptPayload;
  resolve: (value: XiaozeApprovalResolveValue) => void;
}) {
  const [title, setTitle] = useState(interrupt.payload.title ?? "");
  const editedArgs = useMemo(() => ({ ...interrupt.payload, title }), [interrupt.payload, title]);
  const contentPreview = interrupt.payload.contentMarkdown ?? "";

  return (
    <AlertDialog open onOpenChange={() => undefined}>
      <AlertDialogContent className="confirm-dialog" data-testid="xiaoze-approval-card">
        <AlertDialogHeader>
          <AlertDialogTitle>确认创建知识草稿</AlertDialogTitle>
          <AlertDialogDescription>
            小泽建议把本次结论沉淀为知识草稿，请审阅后批准或拒绝。批准只创建草稿，发布前不会进入检索，仍需人工在知识库中发布。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label htmlFor="xiaoze-knowledge-draft-title">草稿标题</Label>
            <Input
              id="xiaoze-knowledge-draft-title"
              aria-label="草稿标题"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <p>
            <strong>标签：</strong>
            {interrupt.payload.tags?.length ? interrupt.payload.tags.join("、") : "—"}
          </p>
          {interrupt.payload.sourceLogId ? (
            <p>
              <strong>来源分析：</strong>
              {interrupt.payload.sourceLogId}
            </p>
          ) : null}
          {contentPreview ? (
            <div className="grid gap-1">
              <Label>内容预览</Label>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2 text-xs">
                {contentPreview.length > 1200 ? `${contentPreview.slice(0, 1200)}…` : contentPreview}
              </pre>
            </div>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel type="button" onClick={() => resolve({ decision: "reject", reason: "Rejected in Xiaoze chat." })}>
            Reject
          </AlertDialogCancel>
          <AlertDialogAction type="button" onClick={() => resolve({ decision: "approve", editedArgs })}>
            Approve
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function XiaozeApprovalCardContent({
  interrupt,
  resolve
}: {
  interrupt: XiaozeInterruptPayload;
  resolve: (value: XiaozeApprovalResolveValue) => void;
}) {
  const [targetValue, setTargetValue] = useState(interrupt.payload.targetValue ?? "");
  const [reason] = useState(interrupt.payload.reason ?? "");
  const [rejectReason, setRejectReason] = useState("");
  const aiReason = interrupt.payload.reason?.trim() ?? "";

  const editedArgs = useMemo(
    () => ({
      ...interrupt.payload,
      targetValue,
      reason
    }),
    [interrupt.payload, reason, targetValue]
  );

  if (interrupt.toolName === "action.createKnowledgeDraft") {
    return <KnowledgeDraftApprovalContent interrupt={interrupt} resolve={resolve} />;
  }

  return (
    <AlertDialog open onOpenChange={() => undefined}>
      <AlertDialogContent
        className="confirm-dialog"
        data-testid="xiaoze-approval-card"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>确认参数变更</AlertDialogTitle>
          <AlertDialogDescription>
            小泽建议提交参数变更，请审阅后批准或拒绝。批准后将经现有审批链写入变更请求。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-3 py-2">
          <p>
            <strong>项目：</strong>
            {interrupt.payload.projectId ?? "—"}
          </p>
          <p>
            <strong>参数：</strong>
            {interrupt.payload.parameterId ?? "—"}
          </p>
          <div className="grid gap-1">
            <Label htmlFor="xiaoze-target-value">目标值</Label>
            <Input
              id="xiaoze-target-value"
              aria-label="目标值"
              value={targetValue}
              onChange={(event) => setTargetValue(event.target.value)}
            />
          </div>
          {aiReason ? (
            <div className="grid gap-1 xiaoze-approval-reason" role="note" aria-label="变更理由">
              <strong>变更理由</strong>
              <p>{aiReason}</p>
            </div>
          ) : null}
          {interrupt.citations?.length ? (
            <ul className="agent-citation-list">
              {interrupt.citations.map((citation) => (
                <li key={citation.id}>
                  {citation.href ? <a href={citation.href}>{citation.label}</a> : citation.label}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="grid gap-1">
            <Label htmlFor="xiaoze-reject-reason">拒绝理由（可选）</Label>
            <Textarea
              id="xiaoze-reject-reason"
              aria-label="拒绝理由"
              value={rejectReason}
              rows={2}
              placeholder="告诉小泽为什么拒绝，帮助它修正建议"
              onChange={(event) => setRejectReason(event.target.value)}
            />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel
            type="button"
            onClick={() =>
              resolve({
                decision: "reject",
                reason: rejectReason.trim() || XIAOZE_APPROVAL_DEFAULT_REJECT_REASON
              })
            }
          >
            拒绝
          </AlertDialogCancel>
          <AlertDialogAction type="button" onClick={() => resolve({ decision: "approve", editedArgs })}>
            批准
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
