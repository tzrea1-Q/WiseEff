import { Button } from "@/components/ui/button";

type SectionSkeletonProps = {
  label: string;
};

export function SectionSkeleton({ label }: SectionSkeletonProps) {
  return (
    // aria-label names the region (role=status has no name-from-content);
    // the sr-only text is what the live region announces.
    <div className="section-skeleton" role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div className="section-skeleton__line wide" />
      <div className="section-skeleton__line medium" />
      <div className="section-skeleton__line wide" />
    </div>
  );
}

type SectionEmptyProps = {
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function SectionEmpty({ title, message, actionLabel, onAction }: SectionEmptyProps) {
  return (
    <div className="section-empty">
      {title ? <strong>{title}</strong> : null}
      <p>{message}</p>
      {actionLabel && onAction ? (
        <Button type="button" variant="outline" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

type SectionErrorProps = {
  message: string;
  detail?: string;
  onRetry: () => void;
};

export function SectionError({ message, detail, onRetry }: SectionErrorProps) {
  return (
    <div className="section-error" role="alert">
      <p>{message}</p>
      {detail ? <p>{detail}</p> : null}
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}
