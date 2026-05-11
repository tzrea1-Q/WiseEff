import { useEffect } from "react";

export function useBeforeUnload(when: boolean, message: string) {
  useEffect(() => {
    if (!when) {
      return undefined;
    }

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };

    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [message, when]);
}
