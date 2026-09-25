import { RuleControls, RunNowButton } from "@/components/rules/rule-controls";
import { RuleForm } from "@/components/rules/rule-form";
import type { Rule } from "@/lib/automations/schema";
import { listRules, listRuns } from "@/lib/automations/store";
import { getDb } from "@/lib/db";
import { getRequestContext } from "@/lib/stripe/request-context";

export const dynamic = "force-dynamic";

const timeLabel = (date: Date) =>
  `${date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}, ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;

function outcomeText(outcome: unknown, error: string | null): string {
  if (error) return `error: ${error}`;
  const o = outcome as { type?: string; message?: string; kind?: string; status?: string; reason?: string } | null;
  if (!o) return "";
  if (o.type === "alert") return `alert: ${o.message}`;
  if (o.type === "brief_item") return `brief: ${o.message}`;
  if (o.type === "draft") return `drafted ${o.kind === "recovery_email" ? "a customer email" : "dispute evidence"}`;
  if (o.type === "proposal") return `${o.status}: ${o.message}`;
  if (o.type === "skipped") return `skipped: ${o.reason}`;
  return "";
}

export default async function RulesPage() {
  const { account, accountId } = await getRequestContext();
  const db = getDb();
  const scope = { accountId, connectionId: account.connection?.id ?? null };
  const [rules, runs] = await Promise.all([listRules(db, scope), listRuns(db, accountId)]);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="page-header">
        <h1>Rules</h1>
        <span className="meta">
          {account.mode === "demo" ? "Demo rules run on Stripe webhooks and the daily cron at 13:00 UTC." : "Event rules need webhooks, which a pasted key cannot register; daily rules run from the button here."} A rule can alert, add a brief line, draft, or propose. It never changes Stripe by itself.
        </span>
      </div>

      <RuleForm />

      <section className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h2>Your rules ({rules.length})</h2>
          <RunNowButton />
        </div>
        {rules.length === 0 ? (
          <p className="meta">No rules yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Runs on</th>
                <th>Last run</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const rule = r.rule as Rule;
                return (
                  <tr key={r.id} className={r.enabled ? "" : "text-muted-foreground"}>
                    <td>
                      <div className="font-medium">{r.name}</div>
                      <div className="meta">{r.readback}</div>
                      <div className="meta">You wrote: {r.sourceText}</div>
                    </td>
                    <td className="whitespace-nowrap">{rule.trigger.type === "event" ? rule.trigger.event : "daily"}</td>
                    <td className="meta whitespace-nowrap">{r.lastRunAt ? timeLabel(r.lastRunAt) : "never"}</td>
                    <td>{r.enabled ? "On" : "Paused"}</td>
                    <td>
                      <RuleControls id={r.id} enabled={r.enabled} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-1">
        <h2>Run history</h2>
        {runs.length === 0 ? (
          <p className="meta">No runs yet. Event rules run when Stripe sends a matching webhook; daily rules run on the cron or the button above.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Rule</th>
                <th>Trigger</th>
                <th>Matched</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(({ run, ruleName }) => (
                <tr key={run.id} className={run.error ? "alert-row" : ""}>
                  <td className="meta whitespace-nowrap">{timeLabel(run.createdAt)}</td>
                  <td>{ruleName}</td>
                  <td className="meta">
                    {run.trigger}
                    {run.eventId && <span className="stripe-id"> {run.eventId}</span>}
                  </td>
                  <td>{run.matched ? "Yes" : "No"}</td>
                  <td className="max-w-96 truncate">{outcomeText(run.outcome, run.error)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
