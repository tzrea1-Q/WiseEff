import { Button } from "@/components/ui/button";

type SectionSkeletonProps = {
  label: string;
};

export function SectionSkeleton({ label }: SectionSkeletonProps) {
  return (
    <div className="section-skeleton" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="section-skeleton__line wide" />
      <div className="section-skeleton__line medium" />
      <div className="section-skeleton__line wide" />
    </div>
  );
}

type SectionEmptyProps = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function SectionEmpty({ message, actionLabel, onAction }: SectionEmptyProps) {
  return (
    <div className="section-empty">
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
  onRetry: () => void;
};

export function SectionError({ message, onRetry }: SectionErrorProps) {
  return (
    <div className="section-error" role="alert">
      <p>{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}
