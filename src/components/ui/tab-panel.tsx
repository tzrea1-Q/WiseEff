import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from "react";

export function TabPanel(props: Omit<ComponentPropsWithoutRef<"div">, "tabIndex">) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const panel = ref.current!;
    const update = () => {
      const hasFocusableContent = [...panel.querySelectorAll<HTMLElement>(
        "a[href], area[href], button, input, select, textarea, summary, audio[controls], video[controls], [tabindex], [contenteditable]"
      )].some((element) => {
        if (element.tabIndex < 0 || element.matches(":disabled") || element.closest("[hidden], [inert]")) return false;
        for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (style.display === "none" || style.visibility === "hidden") return false;
        }
        return true;
      });
      if (panel.hidden || panel.getAttribute("role") !== "tabpanel" || hasFocusableContent) {
        panel.removeAttribute("tabindex");
      } else if (panel.tabIndex !== 0) {
        panel.tabIndex = 0;
      }
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(panel, { subtree: true, childList: true, attributes: true });
    return () => observer.disconnect();
  });
  return <div role="tabpanel" {...props} ref={ref} />;
}
