import { useInterrupt } from "@copilotkit/react-core/v2";
import {
  XiaozeApprovalCardContent,
  type XiaozeApprovalInterrupt,
  type XiaozeApprovalResolveValue
} from "./XiaozeApprovalCardContent";

export type { XiaozeApprovalInterrupt, XiaozeApprovalResolveValue };
export { XiaozeApprovalCardContent };

type XiaozeApprovalCardProps = {
  interrupt?: XiaozeApprovalInterrupt;
  resolve?: (value: XiaozeApprovalResolveValue) => void;
};

function XiaozeApprovalCardInterrupt() {
  useInterrupt({
    enabled: (event) => Boolean((event.value as XiaozeApprovalInterrupt | undefined)?.approvalId),
    render: ({ event, resolve }) => (
      <XiaozeApprovalCardContent
        interrupt={event.value as XiaozeApprovalInterrupt}
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
