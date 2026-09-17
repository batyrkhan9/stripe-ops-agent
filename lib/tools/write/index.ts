import { cancelSubscription } from "./cancel-subscription";
import { createCoupon } from "./create-coupon";
import { createRefund } from "./create-refund";
import { pauseSubscription } from "./pause-subscription";
import { submitDisputeEvidence } from "./submit-dispute-evidence";
import type { WriteToolDefinition } from "./types";

export const WRITE_TOOLS = {
  create_refund: createRefund,
  create_coupon: createCoupon,
  pause_subscription: pauseSubscription,
  cancel_subscription: cancelSubscription,
  submit_dispute_evidence: submitDisputeEvidence,
} as const satisfies Record<string, WriteToolDefinition>;

export type WriteToolName = keyof typeof WRITE_TOOLS;

export function isWriteToolName(name: string): name is WriteToolName {
  return name in WRITE_TOOLS;
}
