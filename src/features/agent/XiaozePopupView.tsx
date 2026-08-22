import {
  type ComponentProps,
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  CopilotChatView,
  CopilotModalHeader,
  useCopilotChatConfiguration
} from "@copilotkit/react-core/v2";
import { XiaozeChatToggleButton } from "./XiaozeChatToggleButton";
import { useXiaozePageContextValue } from "./xiaozePageContext";
import {
  dimensionToCss,
  readXiaozePopupMotionDurations,
  type XiaozePopupMotionPhase
} from "./xiaozePopupMotion";
import { writeXiaozePopupOpenSession } from "./xiaozePopupOpenState";

const DEFAULT_POPUP_WIDTH = 420;
const DEFAULT_POPUP_HEIGHT = 680;

/**
 * The Xiaoze approval card (Radix AlertDialog) portals to <body>, outside the
 * popup container. Without this guard, a pointer-down or scrim click on the
 * approval card counts as "outside" and closes the chat, which abandons the
 * pending interrupt so it can never resolve. Treat anything inside the alert
 * dialog overlay/content as inside the popup.
 */
function isWithinApprovalCard(target: Node) {
  return target instanceof Element
    ? Boolean(target.closest("[data-slot='alert-dialog-content'], [data-slot='alert-dialog-overlay']"))
    : false;
}

export type XiaozePopupViewProps = {
  header?: ComponentProps<typeof CopilotModalHeader>;
  toggleButton?: ComponentProps<typeof XiaozeChatToggleButton>;
  width?: number | string;
  height?: number | string;
  clickOutsideToClose?: boolean;
  className?: string;
} & ComponentProps<typeof CopilotChatView>;

function renderHeaderSlot(header: XiaozePopupViewProps["header"]) {
  if (!header) {
    return <CopilotModalHeader />;
  }
  const { children, ...rest } = header;
  if (children) {
    return <CopilotModalHeader {...rest}>{children}</CopilotModalHeader>;
  }
  return <CopilotModalHeader {...rest} />;
}

function renderToggleSlot(toggleButton: XiaozePopupViewProps["toggleButton"]) {
  if (!toggleButton) {
    return <XiaozeChatToggleButton />;
  }
  return <XiaozeChatToggleButton {...toggleButton} />;
}

export function XiaozePopupView({
  header,
  toggleButton,
  width,
  height,
  clickOutsideToClose = true,
  className,
  ...chatProps
}: XiaozePopupViewProps) {
  const configuration = useCopilotChatConfiguration();
  const isPopupOpen = configuration?.isModalOpen ?? false;
  const setModalOpen = configuration?.setModalOpen;
  const labels = configuration?.labels;
  const modalTitle = labels?.modalHeaderTitle ?? "小泽";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const [isMounted, setIsMounted] = useState(isPopupOpen);
  const [motion, setMotion] = useState<XiaozePopupMotionPhase>(isPopupOpen ? "visible" : "leaving");
  const { openMs, closeMs } = readXiaozePopupMotionDurations();

  const requestClose = useCallback(() => {
    writeXiaozePopupOpenSession(false);
    setModalOpen?.(false);
  }, [setModalOpen]);

  const pageContext = useXiaozePageContextValue();
  const previousPathRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const path = pageContext?.path;
    if (!path) {
      return;
    }

    if (previousPathRef.current === undefined) {
      previousPathRef.current = path;
      requestClose();
      return;
    }

    if (path !== previousPathRef.current) {
      previousPathRef.current = path;
      requestClose();
    }
  }, [pageContext?.path, requestClose]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isPopupOpen;

    if (isPopupOpen && !wasOpen) {
      setIsMounted(true);
      setMotion("entering");
      let frame = 0;
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          setMotion("visible");
        });
      });
      return () => window.cancelAnimationFrame(frame);
    }

    if (!isPopupOpen && wasOpen) {
      setMotion("leaving");
      const timeout = window.setTimeout(() => {
        setIsMounted(false);
      }, closeMs);
      return () => window.clearTimeout(timeout);
    }

    if (isPopupOpen) {
      setIsMounted(true);
      setMotion("visible");
    }
  }, [closeMs, isPopupOpen]);

  useEffect(() => {
    if (!isPopupOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopupOpen, requestClose]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (isPopupOpen || !container?.contains(document.activeElement)) {
      return;
    }

    document.querySelector<HTMLElement>("[data-slot='chat-toggle-button']")?.focus({ preventScroll: true });
  }, [isPopupOpen]);

  useEffect(() => {
    if (!isPopupOpen) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      const container = containerRef.current;
      if (container && !container.contains(document.activeElement)) {
        container.focus({ preventScroll: true });
      }
    }, Math.min(openMs, 280));

    return () => window.clearTimeout(focusTimer);
  }, [isPopupOpen, openMs]);

  useEffect(() => {
    if (!isPopupOpen || !clickOutsideToClose) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (containerRef.current?.contains(target)) {
        return;
      }
      if (isWithinApprovalCard(target)) {
        return;
      }
      const toggle = document.querySelector("[data-slot='chat-toggle-button']");
      if (toggle?.contains(target)) {
        return;
      }
      requestClose();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [clickOutsideToClose, isPopupOpen, requestClose]);

  const popupStyle = useMemo(
    () =>
      ({
        "--copilot-popup-width": dimensionToCss(width, DEFAULT_POPUP_WIDTH),
        "--copilot-popup-height": dimensionToCss(height, DEFAULT_POPUP_HEIGHT),
        "--copilot-popup-max-width": "calc(100vw - 3rem)",
        "--copilot-popup-max-height": "calc(100dvh - 7.5rem)",
        "--xiaoze-popup-open-ms": `${openMs}ms`,
        "--xiaoze-popup-close-ms": `${closeMs}ms`
      }) as CSSProperties,
    [closeMs, height, openMs, width]
  );

  const headerElement = useMemo(() => renderHeaderSlot(header), [header]);
  const toggleButtonElement = useMemo(() => renderToggleSlot(toggleButton), [toggleButton]);

  return (
    <>
      {toggleButtonElement}
      {isMounted ? (
        <div
          className="xiaoze-popup-layer"
          data-motion={motion}
          data-testid="xiaoze-popup-layer"
          style={popupStyle}
        >
          <button
            type="button"
            className="xiaoze-popup-scrim"
            aria-hidden="true"
            tabIndex={-1}
            onClick={(event) => {
              if (clickOutsideToClose && !isWithinApprovalCard(event.target as Node)) {
                requestClose();
              }
            }}
          />
          <div
            ref={containerRef}
            tabIndex={-1}
            role={isPopupOpen ? "dialog" : undefined}
            aria-label={isPopupOpen ? modalTitle : undefined}
            aria-modal={isPopupOpen ? "true" : undefined}
            aria-hidden={isPopupOpen ? undefined : "true"}
            inert={isPopupOpen ? undefined : true}
            data-testid="copilot-popup"
            data-copilot-popup=""
            data-motion={motion}
            className="copilotKitPopup copilotKitWindow xiaoze-popup-window"
            style={popupStyle}
          >
            {headerElement}
            <div className="xiaoze-popup-window__body" data-popup-chat="">
              <CopilotChatView {...chatProps} className={["xiaoze-popup-chat", className].filter(Boolean).join(" ")} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

XiaozePopupView.WelcomeScreen = CopilotChatView.WelcomeScreen;
