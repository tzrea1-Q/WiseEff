import { Button } from "@/components/ui/button";

export function WorkflowPublicationNotice({ status, onRetry, onNavigate }: {
  status: "loading" | "error" | "unpublished";
  onRetry: () => void;
  onNavigate?: (path: string) => void;
}) {
  return <section className="permission-denied-page" aria-label="工作流发布状态" role={status === "error" ? "alert" : undefined}>
    <h2>{status === "loading" ? "正在读取开放状态…" : status === "error" ? "暂时无法读取开放状态" : "暂未开放"}</h2>
    <p role={status === "loading" ? "status" : undefined}>{status === "loading" ? "请稍候，确认后即可进入工作流。" : status === "error" ? "请重试，或返回首页稍后再试。" : "这项工作流尚未向用户开放，请稍后再试。"}</p>
    {status !== "loading" ? <Button type="button" onClick={onRetry}>重新检查</Button> : null}
    {onNavigate ? <Button type="button" variant="outline" onClick={() => onNavigate("/")}>返回首页</Button> : null}
  </section>;
}
