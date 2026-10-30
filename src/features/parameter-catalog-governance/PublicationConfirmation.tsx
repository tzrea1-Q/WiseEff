import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { publicationApprovalCopy, publicationCopy } from "./publicationState";

export function PublicationConfirmation(props: {
  confirm: "preview" | "publish" | null;
  allowed: boolean;
  risk: "low" | "high";
  actor: CatalogActorKind;
  pending: boolean;
  onPreview: () => void;
  onPublish: () => void;
  onCancel: () => void;
}) {
  const publish = props.confirm === "publish";
  return <ConfirmDialog
    open={props.confirm !== null && props.allowed}
    title={publish ? publicationCopy.confirmPublishTitle : publicationCopy.confirmPreviewTitle}
    description={<p>{publish ? publicationApprovalCopy(props.risk, props.actor) : "将按当前内容生成发布预览。"}</p>}
    confirmLabel={publish ? publicationCopy.confirmPublish : publicationCopy.confirmPreview}
    pending={props.pending}
    pendingLabel={publicationCopy.processing}
    acknowledgement={publish ? publicationCopy.publishAck : publicationCopy.previewAck}
    onConfirm={publish ? props.onPublish : props.onPreview}
    onCancel={props.onCancel}
  />;
}
