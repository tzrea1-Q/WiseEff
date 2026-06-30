export const XIAOZE_OPEN_HANDOFF_EVENT = "wiseeff:xiaoze-open-handoff";

export type XiaozeOpenHandoffDetail = {
  preset: string;
};

export function dispatchXiaozeOpenHandoff(preset: string) {
  window.dispatchEvent(
    new CustomEvent<XiaozeOpenHandoffDetail>(XIAOZE_OPEN_HANDOFF_EVENT, {
      detail: { preset }
    })
  );
}
