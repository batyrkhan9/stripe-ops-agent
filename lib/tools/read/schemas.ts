import { z } from "zod";

// Shared input pieces. Stripe IDs are checked by prefix so a malformed ID never reaches the API.
export const stripeId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{6,}$`), `must be a Stripe ID starting with ${prefix}_`);

// Capped at 25: a 50 row list_charges result pushed one request past Groq's 8000 tokens a minute limit.
export const limit = z.number().int().min(1).max(25).default(10).describe("How many rows to return, 1 to 25. Totals already cover every match, so ask only for rows you will mention.");
export const days = z.number().int().min(1).max(365).optional().describe("Only include objects from the last N days");
