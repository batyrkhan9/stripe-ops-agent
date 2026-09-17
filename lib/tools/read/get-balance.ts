import { z } from "zod";
import { formatBalance } from "../format";
import { defineReadTool } from "../types";

export const getBalance = defineReadTool({
  name: "get_balance",
  description: "Get the account balance, available and pending, by currency.",
  input: z.object({}),
  run: async (_input, { stripe }) => formatBalance(await stripe.balance.retrieve()),
});
