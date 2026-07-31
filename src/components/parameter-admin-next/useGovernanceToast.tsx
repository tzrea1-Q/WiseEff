import { useCallback, useEffect, useState } from "react";

const DEFAULT_TOAST_MS = 4000;

export function useGovernanceToast(durationMs = DEFAULT_TOAST_MS) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(null), durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, message]);

  const showToast = useCallback((next: string) => {
    setMessage(next);
  }, []);

  return { message, showToast };
}

export function GovernanceToast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="logs-feedback-toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}
