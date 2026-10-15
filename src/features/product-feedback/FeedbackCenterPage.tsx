import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import type { ProductFeedback } from "@/domain/productFeedback/types";
import { Button } from "@/components/ui/button";
import { FeedbackDialog } from "./FeedbackDialog";
import { MyFeedbackView } from "./MyFeedbackView";
import "./feedback-user.css";

export function FeedbackCenterPage({ productFeedbackRepository, search, onSearchChange }: {
  productFeedbackRepository: ProductFeedbackRepository;
  search?: string;
  onSearchChange?: (search: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(search ?? window.location.search).get("id"));
  const [editingDraft, setEditingDraft] = useState<ProductFeedback | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (search !== undefined) { setSelectedId(new URLSearchParams(search).get("id")); return; }
    const handleNavigation = () => setSelectedId(new URLSearchParams(window.location.search).get("id"));
    window.addEventListener("popstate", handleNavigation);
    return () => window.removeEventListener("popstate", handleNavigation);
  }, [search]);
  const selectFeedback = (id: string | null) => {
    setSelectedId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("id", id); else url.searchParams.delete("id");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    onSearchChange?.(url.search);
  };
  return (
    <section className="feedback-center" aria-label="我的反馈记录">
      {!selectedId && <header className="feedback-center__header"><p>查看处理进展、补充问题信息，或继续完成草稿。</p>
        <Button type="button" onClick={async () => {
          if (await requestSettingsLeave()) { setEditingDraft(null); setComposerOpen(true); }
        }}><Plus size={16} />提交反馈</Button></header>}
      <MyFeedbackView key={revision} productFeedbackRepository={productFeedbackRepository} selectedId={selectedId} onSelectedIdChange={selectFeedback}
        onEditDraft={(draft) => { setEditingDraft(draft); setComposerOpen(true); }} />
      <FeedbackDialog open={composerOpen} pagePath="/feedback" pageTitle="我的反馈" productFeedbackRepository={productFeedbackRepository} initialDraft={editingDraft}
        onOpenChange={(nextOpen) => { setComposerOpen(nextOpen); if (!nextOpen) { setEditingDraft(null); setRevision((value) => value + 1); } }} />
    </section>
  );
}
