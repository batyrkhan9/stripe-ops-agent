import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { agentRuns, traceSpans } from "@/lib/db/schema";
import { getRequestContext } from "@/lib/stripe/request-context";
import type { Span } from "@/lib/trace/recorder";
import { buildSpanTree, flattenTree, runTotals } from "@/lib/trace/tree";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { planner: "Planner", specialist: "Agent", llm: "Model", tool: "Tool" };

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  return <pre className="stripe-id max-h-64 overflow-auto whitespace-pre-wrap break-all bg-muted p-2">{JSON.stringify(value, null, 2)}</pre>;
}

export default async function TracePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { accountId } = await getRequestContext();
  const db = getDb();
  const [run] = await db.select().from(agentRuns).where(and(eq(agentRuns.id, id), eq(agentRuns.accountId, accountId))).limit(1);
  if (!run) notFound();
  const rows = await db.select().from(traceSpans).where(eq(traceSpans.runId, id));
  const spans: Span[] = rows.map((r) => ({
    ...r,
    kind: r.kind as Span["kind"],
    provider: r.provider ?? undefined,
    modelId: r.modelId ?? undefined,
    inputTokens: r.inputTokens ?? undefined,
    outputTokens: r.outputTokens ?? undefined,
    error: r.error ?? undefined,
  }));
  const nodes = flattenTree(buildSpanTree(spans));
  const totals = runTotals(spans);
  const runStart = run.createdAt.getTime() - run.latencyMs;
  const sources = run.sources as { cited?: string[]; unverified?: string[] } | null;
  const plan = run.plan as { agents?: string[]; reason?: string; source?: string; error?: string } | null;

  return (
    <div className="max-w-6xl space-y-4">
      <div className="page-header">
        <h1 className="max-w-3xl truncate">{run.question}</h1>
        <Link className="meta underline" href="/traces">
          All traces
        </Link>
      </div>

      <table className="data-table">
        <tbody>
          {(
            [
              ["Status", run.status === "ok" ? "ok" : `error: ${run.error ?? ""}`],
              ["Routed to", `${plan?.agents?.join(", ") ?? ""} by ${plan?.source === "keywords" ? `keywords (${plan.reason})` : "the planner model"}`],
              ["Latency", `${(run.latencyMs / 1000).toFixed(1)}s`],
              ["Model calls", `${totals.modelCalls}${totals.fellBack ? ", fell back to another model" : ""}: ${totals.models.join(", ")}`],
              ["Tokens", `${totals.inputTokens.toLocaleString("en-US")} in, ${totals.outputTokens.toLocaleString("en-US")} out`],
              ["Tool calls", String(totals.toolCalls)],
              ["Sources", sources?.cited?.length ? sources.cited.join(" ") : "none cited"],
            ] as const
          ).map(([label, value]) => (
            <tr key={label}>
              <td className="label w-40 normal-case tracking-normal">{label}</td>
              <td className={label === "Sources" ? "stripe-id break-all" : label === "Status" && run.status !== "ok" ? "alert-text" : ""}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="data-table">
        <thead>
          <tr>
            <th>Step</th>
            <th>Model</th>
            <th className="num">Tokens</th>
            <th className="num">Start</th>
            <th className="num">Took</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <tr key={node.id} className={node.error ? "alert-row" : ""}>
              <td>
                <details>
                  <summary className="cursor-pointer" style={{ paddingLeft: `${node.depth * 1.25}rem` }}>
                    <span className="label mr-2">{KIND_LABEL[node.kind] ?? node.kind}</span>
                    <span className="font-medium">{node.name}</span>
                    {node.error && <span className="alert-text ml-2">{node.error.slice(0, 120)}</span>}
                  </summary>
                  <div className="space-y-1 pt-1" style={{ paddingLeft: `${node.depth * 1.25 + 1}rem` }}>
                    {node.input !== null && node.input !== undefined && (
                      <div>
                        <span className="meta">Input</span>
                        <Json value={node.input} />
                      </div>
                    )}
                    {node.output !== null && node.output !== undefined && (
                      <div>
                        <span className="meta">Output</span>
                        <Json value={node.output} />
                      </div>
                    )}
                    {node.error && <Json value={node.error} />}
                  </div>
                </details>
              </td>
              <td className="meta whitespace-nowrap">{node.modelId ? `${node.modelId.replace(/^openai\//, "")}${node.provider ? ` (${node.provider})` : ""}` : ""}</td>
              <td className="num">{node.inputTokens !== undefined ? `${node.inputTokens} / ${node.outputTokens ?? 0}` : ""}</td>
              <td className="num meta">+{Math.max(0, (node.startedAt.getTime() - runStart) / 1000).toFixed(1)}s</td>
              <td className="num">{(node.latencyMs / 1000).toFixed(2)}s</td>
            </tr>
          ))}
        </tbody>
      </table>
      {plan?.error && <p className="meta">Planner note: {plan.error}</p>}
    </div>
  );
}
