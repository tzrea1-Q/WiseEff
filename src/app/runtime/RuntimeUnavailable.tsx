import { runtimeDomainLabel, type BlockingRuntimeStatus } from "./runtimeStatus";

type RuntimeUnavailableProps = {
  blocking: BlockingRuntimeStatus;
  onRetry?: () => void;
};

export function RuntimeUnavailable({ blocking, onRetry }: RuntimeUnavailableProps) {
  const isUnavailable = blocking.status.state === "unavailable";
  const title = blocking.status.state === "loading"
    ? `${runtimeDomainLabel(blocking.domain)} 正在加载`
    : `${runtimeDomainLabel(blocking.domain)} 不可用`;
  const message = blocking.status.state === "unavailable"
    ? blocking.status.message
    : "正在加载 API 数据，请稍候。";

  return (
    <section className="runtime-unavailable" role={isUnavailable ? "alert" : "status"} aria-live={isUnavailable ? "assertive" : "polite"}>
      <span className="eyebrow">API runtime</span>
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry ? (
        <button className="button primary" type="button" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </section>
  );
}
