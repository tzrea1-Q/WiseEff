import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (state: { error: Error; reset: () => void }) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * React only surfaces render/lifecycle crashes through class error boundaries.
 * Without one, any unexpected null/shape from the backend blanks the entire app.
 * This boundary keeps a recovery surface visible regardless of the CSS state.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
    if (import.meta.env?.DEV) {
      console.error("[ErrorBoundary] caught render error", error, info);
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    if (this.props.fallback) {
      return this.props.fallback({ error, reset: this.reset });
    }
    return <DefaultErrorFallback error={error} reset={this.reset} label={this.props.label} />;
  }
}

function DefaultErrorFallback({
  error,
  reset,
  label
}: {
  error: Error;
  reset: () => void;
  label?: string;
}): ReactNode {
  const diagnostics = [
    `time: ${new Date().toISOString()}`,
    `url: ${typeof window !== "undefined" ? window.location.href : "n/a"}`,
    `userAgent: ${typeof navigator !== "undefined" ? navigator.userAgent : "n/a"}`,
    `message: ${error.message}`,
    `stack: ${error.stack ?? "n/a"}`
  ].join("\n");

  return (
    <div role="alert" aria-live="assertive" style={containerStyle}>
      <div style={cardStyle}>
        <p style={eyebrowStyle}>{label ? `${label} · 页面出错` : "页面出错"}</p>
        <h1 style={titleStyle}>这个页面暂时无法显示</h1>
        <p style={bodyStyle}>
          页面在渲染时遇到了未预期的错误，已被安全拦截，不会影响你之前已保存的操作。你可以先重试，或刷新页面；如果反复出现，请复制诊断信息并反馈给管理员。
        </p>
        <pre style={detailStyle}>{error.message || "Unknown render error"}</pre>
        <div style={actionsRowStyle}>
          <button type="button" style={primaryButtonStyle} onClick={reset}>
            重试
          </button>
          <button type="button" style={secondaryButtonStyle} onClick={() => window.location.reload()}>
            刷新页面
          </button>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() => {
              window.location.assign("/");
            }}
          >
            返回首页
          </button>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() => {
              void navigator.clipboard?.writeText(diagnostics);
            }}
          >
            复制诊断信息
          </button>
        </div>
      </div>
    </div>
  );
}

const containerStyle: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  background: "#0b1020",
  color: "#e6eaf2",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"
};

const cardStyle: CSSProperties = {
  width: "100%",
  maxWidth: "560px",
  padding: "32px",
  borderRadius: "16px",
  background: "#141a2e",
  border: "1px solid #263049",
  boxShadow: "0 24px 60px rgba(0, 0, 0, 0.45)"
};

const eyebrowStyle: CSSProperties = {
  margin: "0 0 8px",
  fontSize: "12px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#8ea2c6"
};

const titleStyle: CSSProperties = { margin: "0 0 12px", fontSize: "22px", fontWeight: 600 };

const bodyStyle: CSSProperties = { margin: "0 0 16px", fontSize: "14px", lineHeight: 1.7, color: "#b9c4dc" };

const detailStyle: CSSProperties = {
  margin: "0 0 20px",
  padding: "12px 14px",
  borderRadius: "10px",
  background: "#0b1020",
  border: "1px solid #263049",
  color: "#f2a9a0",
  fontSize: "12.5px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: "160px",
  overflow: "auto"
};

const actionsRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: "10px" };

const primaryButtonStyle: CSSProperties = {
  appearance: "none",
  border: "1px solid transparent",
  borderRadius: "10px",
  padding: "10px 16px",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
  background: "#4c7dff",
  color: "#ffffff"
};

const secondaryButtonStyle: CSSProperties = {
  appearance: "none",
  borderRadius: "10px",
  padding: "10px 16px",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
  background: "transparent",
  color: "#cdd7ee",
  border: "1px solid #334060"
};
