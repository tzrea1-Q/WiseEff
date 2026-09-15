export const XIAOZE_OPEN_HANDOFF_EVENT = "wiseeff:xiaoze-open-handoff";

export type XiaozeOpenHandoffDetail = {
  preset?: string;
  text?: string;
};

export function dispatchXiaozeOpenHandoff(detail: string | XiaozeOpenHandoffDetail) {
  const payload: XiaozeOpenHandoffDetail =
    typeof detail === "string"
      ? detail.startsWith("knowledge-") || detail.startsWith("log-")
        ? { preset: detail }
        : { text: detail }
      : detail;

  window.dispatchEvent(
    new CustomEvent<XiaozeOpenHandoffDetail>(XIAOZE_OPEN_HANDOFF_EVENT, {
      detail: payload
    })
  );
}
