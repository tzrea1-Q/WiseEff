import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  dismissXiaozeToggleHint,
  markXiaozeToggleHintShown,
  readXiaozeToggleHintDismissed,
  readXiaozeToggleHintShown,
  XIAOZE_TOGGLE_HINT_DELAY_MS
} from "./xiaozeToggleHintStorage";

type XiaozeToggleHintProps = {
  userId?: string;
  visible: boolean;
  onOpen: () => void;
};

export function XiaozeToggleHint({ userId, visible, onOpen }: XiaozeToggleHintProps) {
  const [dismissed, setDismissed] = useState(() => readXiaozeToggleHintDismissed(userId));
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!visible || dismissed || readXiaozeToggleHintShown(userId)) {
      setRevealed(false);
      return;
    }

    const timer = window.setTimeout(() => {
      markXiaozeToggleHintShown(userId);
      setRevealed(true);
    }, XIAOZE_TOGGLE_HINT_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [dismissed, userId, visible]);

  if (!visible || dismissed || !revealed) {
    return null;
  }

  const handleDismiss = () => {
    dismissXiaozeToggleHint(userId);
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
