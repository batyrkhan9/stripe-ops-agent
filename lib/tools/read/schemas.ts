import { z } from "zod";

// Shared input pieces. Stripe IDs are checked by prefix so a malformed ID never reaches the API.
export const stripeId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{6,}$`), `must be a Stripe ID starting with ${prefix}_`);

export const limit = z.number().int().min(1).max(50).default(10).describe("How many objects to return, 1 to 50");
export const days = z.number().int().min(1).max(365).optional().describe("Only include objects from the last N days");
