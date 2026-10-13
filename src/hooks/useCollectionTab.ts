import { useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}

const getSearch = () => window.location.search;

export function useCollectionTab(tabs: readonly string[], fallback: string) {
  const search = useSyncExternalStore(subscribe, getSearch);
  const requested = new URLSearchParams(search).get("tab");
  const tab = requested && tabs.includes(requested) ? requested : fallback;

  const selectTab = (value: string) => {
    if (!tabs.includes(value) || value === tab) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  return [tab, selectTab] as const;
}
