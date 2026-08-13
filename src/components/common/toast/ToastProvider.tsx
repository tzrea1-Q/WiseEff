import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";

const DEFAULT_TOAST_DURATION_MS = 4000;

export type ToastTone = "success" | "info" | "danger";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastInput = {
  tone: ToastTone;
  message: string;
  action?: ToastAction;
  durationMs?: number;
};

type ToastItem = ToastInput & { id: number };

type ToastContextValue = {
  toast: (input: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const toneIcons = {
  success: CheckCircle2,
  info: Info,
  danger: AlertTriangle
} as const;

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const durationMs = item.durationMs ?? DEFAULT_TOAST_DURATION_MS;

  useEffect(() => {
    if (paused) {
      return undefined;
    }
    const timer = window.setTimeout(() => onDismiss(item.id), durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, item.id, onDismiss, paused]);

  const ToneIcon = toneIcons[item.tone];
  const isAlert = item.tone === "danger";

  return (
    <div
      className={`toast toast--${item.tone}`}
      role={isAlert ? "alert" : "status"}
      aria-live={isAlert ? "assertive" : "polite"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <ToneIcon className="toast__icon" size={16} aria-hidden="true" />
      <span className="toast__message">{item.message}</span>
      {item.action ? (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            item.action?.onClick();
            onDismiss(item.id);
          }}
        >
          {item.action.label}
        </button>
      ) : null}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    nextIdRef.current += 1;
    const id = nextIdRef.current;
    setItems((current) => [...current, { ...input, id }]);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {items.length > 0
        ? createPortal(
            <div className="toast-viewport">
              {items.map((item) => (
                <ToastCard item={item} key={item.id} onDismiss={dismiss} />
              ))}
            </div>,
            document.body
          )
        : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider.");
  }
  return context;
}
