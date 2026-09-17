import type Stripe from "stripe";
import type { z } from "zod";
import type { WritePermission } from "@/lib/stripe/permissions";

// What the merchant reviews before confirming: one sentence, supporting facts, and the objects it touches.
export type ProposalDescription = {
  summary: string; // "Refund $195.00 to Maya Patel for the Sep 11 charge"
  details: string[];
  targetIds: string[];
  confirmLabel: string; // "Confirm refund of $195.00"
};

// A write tool never runs when the model calls it (ADR 0003). The model's call only runs describe, which reads
// Stripe to check the target and build the proposal. execute runs only from the Confirm button, after the server
// re-checks the key's permission.
export type WriteToolDefinition<Schema extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  permission: WritePermission;
  input: Schema;
  describe: (input: z.infer<Schema>, ctx: { stripe: Stripe; now: number }) => Promise<ProposalDescription>;
  execute: (input: z.infer<Schema>, ctx: { stripe: Stripe; idempotencyKey: string }) => Promise<{ id: string; status: string }>;
};

export function defineWriteTool<Schema extends z.ZodType>(definition: WriteToolDefinition<Schema>) {
  return definition;
}

// Thrown by describe when the target cannot take the action, such as refunding a failed charge. The message goes
// back to the model and to the merchant.
export class ProposalRejected extends Error {}
