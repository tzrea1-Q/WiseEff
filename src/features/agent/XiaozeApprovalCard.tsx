import { useInterrupt } from "@copilotkit/react-core/v2";
import type { XiaozeInterruptPayload } from "@wiseeff/xiaoze-protocol";
import {
  XiaozeApprovalCardContent,
  type XiaozeApprovalResolveValue
} from "./XiaozeApprovalCardContent";

export type { XiaozeApprovalResolveValue };
export { XiaozeApprovalCardContent };

type XiaozeApprovalCardProps = {
  interrupt?: XiaozeInterruptPayload;
  resolve?: (value: XiaozeApprovalResolveValue) => void;
};

function XiaozeApprovalCardInterrupt() {
  useInterrupt({
    enabled: (event) => Boolean((event.value as XiaozeInterruptPayload | undefined)?.approvalId),
    render: ({ event, resolve }) => (
      <XiaozeApprovalCardContent
        interrupt={event.value as XiaozeInterruptPayload}
        resolve={(value) => void resolve(value)}
      />
    )
  });
  return null;
}

export function XiaozeApprovalCard(props: XiaozeApprovalCardProps = {}) {
  if (props.interrupt && props.resolve) {
    return <XiaozeApprovalCardContent interrupt={props.interrupt} resolve={props.resolve} />;
  }
  return <XiaozeApprovalCardInterrupt />;
}
