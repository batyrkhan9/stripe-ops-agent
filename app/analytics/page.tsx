import { DeclineTable, MrrBars } from "@/components/analytics/charts";
import { Narrative, type StoredNarrative } from "@/components/analytics/narrative";
import { loadAnalyticsData } from "@/lib/analytics/load";
import { buildAnalyticsSummary, narrativeTarget } from "@/lib/analytics/summary";
import { getDb } from "@/lib/db";
import { latestDraft } from "@/lib/db/drafts";
import { dateLabel } from "@/lib/format/human";
import { getRequestContext } from "@/lib/stripe/request-context";

export const dynamic = "force-dynamic";

function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="border-r px-3 py-2 last:border-r-0">
      <div className="label">{label}</div>
      <div className="num text-left text-[1.4rem] font-semibold">{value}</div>
      <div className="meta">{detail}</div>
    </div>
  );
}

export default async function AnalyticsPage() {
  const { account, accountId, now } = await getRequestContext();
  const [data, draft] = await Promise.all([
    loadAnalyticsData(account.stripe, now),
    latestDraft(getDb(), { accountId, kind: "analytics_narrative", targetId: narrativeTarget(now) }),
  ]);
  const s = buildAnalyticsSummary(data, now);
  const content = draft?.content as { text: string; unverified: string[]; sources: string[] } | undefined;
  const narrative: StoredNarrative | null = content
    ? { ...content, label: `Written ${dateLabel(Math.floor(draft!.createdAt.getTime() / 1000))}${draft!.modelId ? ` by ${draft!.modelId}` : ""}` }
    : null;
  const pct = s.labels.pct;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="page-header">
        <h1>Analytics</h1>
        <span className="meta">
          {account.mode === "demo" ? `Demo account as of ${dateLabel(now)}, dated by seeded occurred_at` : `As of ${dateLabel(now)}`}
        </span>
      </div>

      <div className="grid grid-cols-2 border border-strong-border md:grid-cols-4">
        <Kpi label="MRR" value={s.labels.mrr} detail={`${s.liveCount} subscriptions, ${s.pastDueCount} past due`} />
        <Kpi label="Net MRR, 30 days" value={s.labels.net} detail={`${s.labels.newMrr} new, ${s.labels.churnedMrr} churned`} />
        <Kpi label="Churn, 30 days" value={s.labels.churnRate} detail={`${s.churn.canceled} of ${s.churn.activeAtStart} canceled, revenue ${s.labels.revenueChurn}`} />
        <Kpi label="Gross volume, 30 days" value={s.labels.gross} detail={`${s.gross.count} successful payments`} />
      </div>

      <section className="space-y-2">
        <h2>Narrative</h2>
        <Narrative narrative={narrative} />
      </section>

      <section className="space-y-1">
        <h2>MRR by week</h2>
        <MrrBars points={s.series} currency={s.currency} now={now} />
      </section>

      <section className="space-y-1">
        <h2>Cohort retention</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Started</th>
              <th className="num">Subscriptions</th>
              <th className="num">Month 0</th>
              <th className="num">Month 1</th>
              <th className="num">Month 2</th>
              <th className="num">Month 3</th>
            </tr>
          </thead>
          <tbody>
            {s.cohorts.map((c) => (
              <tr key={c.month}>
                <td>{new Date(`${c.month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}</td>
                <td className="num">{c.size}</td>
                {c.retained.map((r, i) => (
                  <td key={i} className={`num ${r !== null && r < 0.8 ? "alert-text" : ""}`}>
                    {r === null ? "" : pct(r, 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-1">
          <h2>Decline rate by card brand, 30 days</h2>
          <DeclineTable rows={s.byBrand} label="Brand" />
        </div>
        <div className="space-y-1">
          <h2>Decline rate by card country, 30 days</h2>
          <DeclineTable rows={s.byCountry} label="Country" />
        </div>
      </section>

      <details className="meta max-w-3xl">
        <summary className="cursor-pointer select-none">How these are calculated</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>MRR: active and past-due subscriptions, each at its current price normalized to a month (yearly divided by 12). Plan changes are not split out.</li>
          <li>Net MRR: MRR now minus MRR 30 days ago. New is subscriptions started in the window and still live; churned is subscriptions canceled in the window.</li>
          <li>Churn: subscriptions live 30 days ago that were canceled since, over subscriptions live 30 days ago. Revenue churn uses their MRR.</li>
          <li>Cohort retention: subscriptions grouped by start month; each month shows the share not canceled by that month end (the current month is measured today).</li>
          <li>Decline rate: failed charge attempts over all attempts, grouped by the card. Stripe documents decline test cards only for Visa in the US, so in the demo every decline is Visa, US; other brands and countries vary only through successful charges.</li>
          <li>Subscriptions canceled within an hour of creation never billed and are left out.</li>
        </ul>
      </details>
    </div>
  );
}
