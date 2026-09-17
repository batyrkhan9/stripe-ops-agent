import { desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { agentRuns, traceSpans } from "@/lib/db/schema";
import { getRequestContext } from "@/lib/stripe/request-context";

export const dynamic = "force-dynamic";

const timeLabel = (date: Date) =>
  `${date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}, ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" })}`;

export default async function TracesPage() {
  const { accountId } = await getRequestContext();
  const db = getDb();
  const runs = await db.select().from(agentRuns).where(eq(agentRuns.accountId, accountId)).orderBy(desc(agentRuns.createdAt)).limit(100);
  const stats = runs.length
    ? await db
        .select({
          runId: traceSpans.runId,
          tokens: sql<number>`coalesce(sum(${traceSpans.inputTokens}), 0) + coalesce(sum(${traceSpans.outputTokens}), 0)`,
          models: sql<string[]>`array_remove(array_agg(distinct ${traceSpans.modelId}), null)`,
          errors: sql<number>`count(${traceSpans.error})`,
        })
        .from(traceSpans)
        .where(inArray(traceSpans.runId, runs.map((r) => r.id)))
        .groupBy(traceSpans.runId)
    : [];
  const byRun = new Map(stats.map((s) => [s.runId, s]));

  return (
    <div className="max-w-6xl space-y-4">
      <div className="page-header">
        <h1>Traces</h1>
        <span className="meta">Every chat run: routing, specialists, model calls, and tool calls. Times in UTC.</span>
      </div>
      {runs.length === 0 ? (
        <p className="meta">No runs yet. Ask a question on Ask.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Question</th>
              <th>Agents</th>
              <th>Models</th>
              <th className="num">Tokens</th>
              <th className="num">Latency</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const s = byRun.get(run.id);
              const plan = run.plan as { agents?: string[]; source?: string } | null;
              const failed = run.status !== "ok" || Number(s?.errors ?? 0) > 0;
              return (
                <tr key={run.id}>
                  <td className="meta whitespace-nowrap">{timeLabel(run.createdAt)}</td>
                  <td className="max-w-80 truncate">
                    <Link className="underline" href={`/traces/${run.id}`}>
                      {run.question}
                    </Link>
                  </td>
                  <td>
                    {plan?.agents?.join(", ")}
                    {plan?.source === "keywords" && <span className="meta"> (keywords)</span>}
                  </td>
                  <td className="meta max-w-56 truncate">{(s?.models ?? []).map((m) => m.replace(/^openai\//, "")).join(", ")}</td>
                  <td className="num">{Number(s?.tokens ?? 0).toLocaleString("en-US")}</td>
                  <td className="num">{(run.latencyMs / 1000).toFixed(1)}s</td>
                  <td className={failed ? "alert-text" : "meta"}>{run.status !== "ok" ? "error" : Number(s?.errors ?? 0) > 0 ? `${s?.errors} step errors` : "ok"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
