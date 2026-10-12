import { useId } from "react";
import { Button } from "@/components/ui/button";
import "./overview-page.css";

export function RetiredNotice({ title, description, actionLabel, actionPath, onNavigate }: {
  title: string;
  description: string;
  actionLabel: string;
  actionPath: string;
  onNavigate: (path: string) => void;
}) {
  const titleId = useId();
  return (
    <section className="retired-notice" aria-labelledby={titleId}>
      <div className="retired-notice__content">
        <h2 id={titleId}>{title}</h2>
        <p>{description}</p>
        <Button asChild>
          <a href={actionPath} onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onNavigate(actionPath);
          }}>{actionLabel}</a>
        </Button>
      </div>
    </section>
  );
}
