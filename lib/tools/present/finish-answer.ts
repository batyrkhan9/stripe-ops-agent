import { z } from "zod";
import { PAGES, type NextAction, type PageName } from "@/lib/cards/types";
import { STRIPE_ID_PATTERN } from "../format";
import { defineReadTool } from "../types";

const PAGE_NAMES = Object.keys(PAGES) as [PageName, ...PageName[]];

export const finishAnswer = defineReadTool({
  name: "finish_answer",
  description:
    "Call exactly once, last, after writing your answer. Give the single next action the merchant should take (one short imperative sentence, no IDs), the page where they can do it or none, and every Stripe object ID your answer relied on.",
  input: z.object({
    next_action: z.string().min(3).max(300),
    page: z.enum([...PAGE_NAMES, "none"]),
    source_ids: z.array(z.string().max(80)).max(30),
  }),
  run: async ({ next_action, page, source_ids }): Promise<NextAction & { source_ids: string[] }> => {
    // Rejected rather than stripped: removing IDs left sentences like "Submit evidence for dispute and dispute".
    // The error makes the run retry the call on the other model chain.
    if (new RegExp(STRIPE_ID_PATTERN.source).test(next_action)) {
      throw new Error("next_action must name customers and amounts, not Stripe IDs");
    }
    return {
      text: next_action.trim(),
      page: page === "none" ? null : page,
      button: page === "none" ? null : { label: PAGES[page].label, href: PAGES[page].href },
      source_ids,
    };
  },
});
