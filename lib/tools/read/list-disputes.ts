import { z } from "zod";
import { formatDispute } from "../format";
import { collectByDate, defineReadTool } from "../types";
import { days, limit } from "./schemas";

const OPEN = ["warning_needs_response", "needs_response", "warning_under_review", "under_review"];

export const listDisputes = defineReadTool({
  name: "list_disputes",
  description:
    "List disputes, newest first, with counts by status and reason. status 'open' means still needs a response or is under review, and returns every open dispute whatever its age. Rows include the customer's name and the order metadata of the disputed charge.",
  input: z.object({
    status: z.enum(["open", "needs_response", "under_review", "won", "lost", "all"]).default("all"),
    days,
    limit,
  }),
  run: async (input, { stripe, now }) => {
    // An open dispute needs a response however old it is, so the days filter does not apply to open statuses.
    // The model once passed days 7 for "which disputes need a response" and hid an 11 day old dispute.
    const windowed = !["open", "needs_response", "under_review"].includes(input.status);
    const all = await collectByDate(stripe.disputes.list({ limit: 100, expand: ["data.charge.customer"] }), {
      now,
      days: windowed ? input.days : undefined,
    });
    const matching = all.filter((d) =>
      input.status === "all" ? true : input.status === "open" ? OPEN.includes(d.status) : d.status.endsWith(input.status),
    );
    const tally = (key: "status" | "reason") => all.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d[key]]: (acc[d[key]] ?? 0) + 1 }), {});
    return {
      ...(input.days && !windowed ? { note: "days is ignored for open disputes: every open dispute is listed" } : {}),
      counts_by_status: tally("status"),
      counts_by_reason: tally("reason"),
      matching: matching.length,
      disputes: matching.slice(0, input.limit).map((d) => formatDispute(d, { now })),
    };
  },
});
