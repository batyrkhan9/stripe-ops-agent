import { z } from "zod";
import { formatDispute } from "../format";
import { collectByDate, defineReadTool } from "../types";
import { days, limit } from "./schemas";

const OPEN = ["warning_needs_response", "needs_response", "warning_under_review", "under_review"];

export const listDisputes = defineReadTool({
  name: "list_disputes",
  description: "List disputes, newest first, with counts by status and reason. status 'open' means still needs a response or is under review. Rows include the customer and the order metadata of the disputed charge.",
  input: z.object({
    status: z.enum(["open", "needs_response", "under_review", "won", "lost", "all"]).default("all"),
    days,
    limit,
  }),
  run: async (input, { stripe, now }) => {
    const all = await collectByDate(stripe.disputes.list({ limit: 100, expand: ["data.charge"] }), { now, days: input.days });
    const matching = all.filter((d) =>
      input.status === "all" ? true : input.status === "open" ? OPEN.includes(d.status) : d.status.endsWith(input.status),
    );
    const tally = (key: "status" | "reason") => all.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d[key]]: (acc[d[key]] ?? 0) + 1 }), {});
    return {
      counts_by_status: tally("status"),
      counts_by_reason: tally("reason"),
      matching: matching.length,
      disputes: matching.slice(0, input.limit).map((d) => formatDispute(d)),
    };
  },
});
