import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supportsXiaozeProactiveInsightPage } from "./xiaozeProactiveInsights";
import { useXiaozePageContextValue } from "./xiaozePageContext";
import {
  dismissXiaozeToggleHint,
  markXiaozeToggleHintShown,
  readXiaozeToggleHintDismissed,
  readXiaozeToggleHintShown,
  XIAOZE_TOGGLE_HINT_DELAY_MS
} from "./xiaozeToggleHintStorage";

type XiaozeToggleHintProps = {
  visible: boolean;
  onOpen: () => void;
};

export function XiaozeToggleHint({ visible, onOpen }: XiaozeToggleHintProps) {
  const pageContext = useXiaozePageContextValue();
  const pageHasProactiveInsights = pageContext?.pageKey
    ? supportsXiaozeProactiveInsightPage(pageContext.pageKey)
    : false;
  const [dismissed, setDismissed] = useState(() => readXiaozeToggleHintDismissed());
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!visible || dismissed || pageHasProactiveInsights || readXiaozeToggleHintShown()) {
      setRevealed(false);
      return;
    }

    const timer = window.setTimeout(() => {
      markXiaozeToggleHintShown();
      setRevealed(true);
    }, XIAOZE_TOGGLE_HINT_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [dismissed, pageHasProactiveInsights, visible]);

  if (!visible || dismissed || pageHasProactiveInsights || !revealed) {
    return null;
  }

  const handleDismiss = () => {
    dismissXiaozeToggleHint();
    setDismissed(true);
  };

  return (
    <div className="xiaoze-toggle-hint" data-testid="xiaoze-toggle-hint" role="status" aria-live="polite">
      <button type="button" className="xiaoze-toggle-hint__body" onClick={onOpen}>
        有问题？点这里问小泽
      </button>
      <button
        type="button"
        className="xiaoze-toggle-hint__dismiss"
        aria-label="不再提示"
        onClick={handleDismiss}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
