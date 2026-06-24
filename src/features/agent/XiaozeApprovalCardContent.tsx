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

export type XiaozeApprovalInterrupt = {
  approvalId: string;
  toolCallId?: string;
  toolName: string;
  payload: {
    projectId?: string;
    parameterId?: string;
    targetValue?: string;
    reason?: string;
  };
  citations?: Array<{ id: string; label: string; href?: string; snippet?: string }>;
};

export type XiaozeApprovalResolveValue = {
  decision: "approve" | "reject";
  editedArgs?: Record<string, unknown>;
  reason?: string;
};

export function XiaozeApprovalCardContent({
  interrupt,
  resolve
}: {
  interrupt: XiaozeApprovalInterrupt;
  resolve: (value: XiaozeApprovalResolveValue) => void;
}) {
  const [targetValue, setTargetValue] = useState(interrupt.payload.targetValue ?? "");
  const [reason] = useState(interrupt.payload.reason ?? "");

  const editedArgs = useMemo(
    () => ({
      ...interrupt.payload,
      targetValue,
      reason
    }),
    [interrupt.payload, reason, targetValue]
  );

  return (
    <AlertDialog open onOpenChange={() => undefined}>
      <AlertDialogContent className="confirm-dialog" data-testid="xiaoze-approval-card">
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
            <Label htmlFor="xiaoze-target-value">Target value</Label>
            <Input
              id="xiaoze-target-value"
              aria-label="Target value"
              value={targetValue}
              onChange={(event) => setTargetValue(event.target.value)}
            />
          </div>
          {interrupt.citations?.length ? (
            <ul className="agent-citation-list">
              {interrupt.citations.map((citation) => (
                <li key={citation.id}>
                  {citation.href ? <a href={citation.href}>{citation.label}</a> : citation.label}
                </li>
              ))}
            </ul>
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
