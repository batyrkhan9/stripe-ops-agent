import type Stripe from "stripe";
import type { z } from "zod";
import { effectiveTime, redactSecrets, stripeIdsIn } from "./format";

export type AuditRecord = {
  agent: string;
  tool: string;
  params: unknown;
  stripeIds: string[];
  result: unknown;
};

export type ToolContext = {
  stripe: Stripe;
  agent: string;
  // Demo mode: the seed anchor. Connected accounts: the real current time. Unix seconds.
  now: number;
  audit: (record: AuditRecord) => Promise<void>;
  // Called after every tool call so the run can build the Sources block and trace.
  onToolResult?: (result: { tool: string; params: unknown; stripeIds: string[]; ok: boolean; ms: number }) => void;
};

export type ReadToolDefinition<Schema extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: Schema;
  run: (input: z.infer<Schema>, ctx: ToolContext) => Promise<unknown>;
};

export function defineReadTool<Schema extends z.ZodType>(definition: ReadToolDefinition<Schema>) {
  return definition;
}

// Every tool call goes through here: validate, run, audit, and never let a key reach the model.
export async function executeReadTool(definition: ReadToolDefinition, rawInput: unknown, ctx: ToolContext): Promise<unknown> {
  const started = Date.now();
  const parsed = definition.input.safeParse(rawInput);
  let output: unknown;
  let ok = true;
  if (!parsed.success) {
    ok = false;
    output = { error: "invalid_input", issues: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`) };
  } else {
    try {
      output = await definition.run(parsed.data, ctx);
    } catch (error) {
      ok = false;
      const code = (error as { code?: string; type?: string }).code ?? (error as { type?: string }).type ?? "error";
      output = { error: code, message: redactSecrets(error instanceof Error ? error.message : String(error)) };
    }
  }

  const stripeIds = stripeIdsIn(output);
  await ctx.audit({ agent: ctx.agent, tool: definition.name, params: rawInput, stripeIds, result: output });
  ctx.onToolResult?.({ tool: definition.name, params: rawInput, stripeIds, ok, ms: Date.now() - started });
  return output;
}

type Dated = { created: number; metadata?: Stripe.Metadata | null };

// Objects left in the demo account by design experiments (README, Documented leftovers) are not business
// data, so list and search tools skip them. Real accounts never carry this tag.
export function isExperimentLeftover(item: { metadata?: Stripe.Metadata | null }): boolean {
  return item.metadata?.seed_key === "experiment";
}

// Lists by intended date. Stripe's own created filter would be wrong for seeded demo data, so collect
// up to maxScan objects, filter by effectiveTime, and sort newest first.
export async function collectByDate<T extends Dated>(
  pages: AsyncIterable<T>,
  options: { now: number; days?: number; maxScan?: number; where?: (item: T) => boolean },
): Promise<T[]> {
  const since = options.days ? options.now - options.days * 86_400 : -Infinity;
  const items: T[] = [];
  let scanned = 0;
  for await (const item of pages) {
    if (++scanned > (options.maxScan ?? 1000)) break;
    if (isExperimentLeftover(item)) continue;
    const time = effectiveTime(item);
    if (time > since && time <= options.now && (options.where?.(item) ?? true)) items.push(item);
  }
  return items.sort((a, b) => effectiveTime(b) - effectiveTime(a));
}
