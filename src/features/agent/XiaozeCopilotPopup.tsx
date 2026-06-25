import { type ComponentProps, useMemo, useRef } from "react";
import { CopilotChat, CopilotChatView } from "@copilotkit/react-core/v2";
import { XiaozePopupChrome } from "./XiaozePopupChrome";
import { XiaozePopupView } from "./XiaozePopupView";

type XiaozeCopilotPopupProps = ComponentProps<typeof CopilotChat> & {
  header?: ComponentProps<typeof XiaozePopupView>["header"];
  toggleButton?: ComponentProps<typeof XiaozePopupView>["toggleButton"];
  width?: ComponentProps<typeof XiaozePopupView>["width"];
  height?: ComponentProps<typeof XiaozePopupView>["height"];
  clickOutsideToClose?: ComponentProps<typeof XiaozePopupView>["clickOutsideToClose"];
  defaultOpen?: boolean;
};

export function XiaozeCopilotPopup({
  header,
  toggleButton,
  defaultOpen,
  width,
  height,
  clickOutsideToClose,
  ...chatProps
}: XiaozeCopilotPopupProps) {
  const headerRef = useRef(header);
  const toggleButtonRef = useRef(toggleButton);
  const widthRef = useRef(width);
  const heightRef = useRef(height);
  const clickOutsideToCloseRef = useRef(clickOutsideToClose);

  headerRef.current = header;
  toggleButtonRef.current = toggleButton;
  widthRef.current = width;
  heightRef.current = height;
  clickOutsideToCloseRef.current = clickOutsideToClose;

  const PopupViewOverride = useMemo(() => {
    const Component = (viewProps: ComponentProps<typeof CopilotChatView>) => {
      const {
        header: viewHeader,
        toggleButton: viewToggleButton,
        width: viewWidth,
        height: viewHeight,
        clickOutsideToClose: viewClickOutsideToClose,
        defaultOpen: viewDefaultOpen,
        ...restProps
      } = viewProps as ComponentProps<typeof XiaozePopupView> & { defaultOpen?: boolean };

      return (
        <XiaozePopupView
          {...restProps}
          header={headerRef.current ?? viewHeader}
          toggleButton={toggleButtonRef.current ?? viewToggleButton}
          width={widthRef.current ?? viewWidth}
          height={heightRef.current ?? viewHeight}
          clickOutsideToClose={clickOutsideToCloseRef.current ?? viewClickOutsideToClose}
        />
      );
    };

    return Object.assign(Component, CopilotChatView);
  }, []);

  return (
    <>
      <XiaozePopupChrome />
      <CopilotChat
        welcomeScreen={XiaozePopupView.WelcomeScreen}
        {...chatProps}
        isModalDefaultOpen={defaultOpen ?? false}
        chatView={PopupViewOverride as typeof CopilotChatView}
      />
    </>
  );
}

export type { XiaozeCopilotPopupProps };
