import type { ComponentProps } from "react";
import { useRef } from "react";
import { CopilotChatView } from "@copilotkit/react-core/v2";
import { useXiaozeChatAutoScroll } from "./useXiaozeChatAutoScroll";

const SCROLL_BUTTON_OFFSET = 16;
const VALID_AUTO_SCROLL = ["pin-to-bottom", "pin-to-send", "none"] as const;

type AutoScrollMode = (typeof VALID_AUTO_SCROLL)[number];

type XiaozeChatScrollViewProps = ComponentProps<typeof CopilotChatView.ScrollView>;

function normalizeAutoScroll(value: XiaozeChatScrollViewProps["autoScroll"]): AutoScrollMode {
  if (value === undefined || value === true) {
    return "pin-to-bottom";
  }
  if (value === false) {
    return "none";
  }
  if (VALID_AUTO_SCROLL.includes(value)) {
    return value;
  }
  return "pin-to-bottom";
}

export function XiaozeChatScrollView({
  autoScroll = true,
  children,
  className,
  inputContainerHeight = 0,
  isResizing = false,
  ...props
}: XiaozeChatScrollViewProps) {
  const mode = normalizeAutoScroll(autoScroll);

  if (mode !== "pin-to-bottom") {
    return (
      <CopilotChatView.ScrollView autoScroll={autoScroll} className={className} inputContainerHeight={inputContainerHeight} isResizing={isResizing} {...props}>
        {children}
      </CopilotChatView.ScrollView>
    );
  }

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const { showScrollButton, scrollToBottom } = useXiaozeChatAutoScroll(scrollRef, contentRef);

  return (
    <div
      className={["cpk:h-full cpk:max-h-full cpk:flex cpk:flex-col cpk:min-h-0 cpk:relative", className].filter(Boolean).join(" ")}
      {...props}
    >
      <div
        ref={scrollRef}
        className="cpk:flex-1 cpk:min-h-0 cpk:overflow-y-auto cpk:overflow-x-hidden xiaoze-chat-scroll"
      >
        <div
          ref={contentRef}
          className="cpk:px-4 cpk:sm:px-0 cpk:[div[data-sidebar-chat]_&]:px-8 cpk:[div[data-popup-chat]_&]:px-6"
        >
          {children}
        </div>
      </div>
      <CopilotChatView.Feather />
      {showScrollButton && !isResizing ? (
        <div
          className="cpk:absolute cpk:inset-x-0 cpk:flex cpk:justify-center cpk:z-30 cpk:pointer-events-none"
          style={{ bottom: `${inputContainerHeight + SCROLL_BUTTON_OFFSET}px` }}
        >
          <CopilotChatView.ScrollToBottomButton onClick={() => scrollToBottom("smooth")} />
        </div>
      ) : null}
    </div>
  );
}
