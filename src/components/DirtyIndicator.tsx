export function DirtyIndicator({ count, onInspect }: { count: number; onInspect: () => void }) {
  if (count <= 0) {
    return null;
  }

  return (
    <button
      aria-label={`${count} 处未导出，点击查看变更摘要`}
      className="dirty-indicator"
      title={`自上次导出以来已修改 ${count} 处参数`}
      type="button"
      onClick={onInspect}
    >
      <span aria-hidden="true" className="dirty-dot">
        ●
      </span>
      <span>{count} 处未导出</span>
    </button>
  );
}
