import { CardList } from "@/components/cards/card-list";
import { BuildBriefButton } from "@/components/briefs/build-button";
import type { Brief } from "@/lib/brief/build";
import { listBriefs } from "@/lib/brief/store";
import { getDb } from "@/lib/db";
import { getRequestContext } from "@/lib/stripe/request-context";

export const dynamic = "force-dynamic";

const dayLabel = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export default async function BriefsPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { day } = await searchParams;
  const { account, accountId } = await getRequestContext();
  const rows = await listBriefs(getDb(), accountId);
  const selected = rows.find((r) => r.dayKey === day) ?? rows[0];
  const brief = selected?.content as Brief | undefined;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="page-header">
        <h1>Briefs</h1>
        <span className="meta">
          {account.mode === "demo" ? "Built daily at 13:00 UTC by cron for the demo account, and emailed when Resend is configured." : "Built on demand for your account."}
        </span>
      </div>

      <BuildBriefButton label={rows.length ? "Rebuild today's brief" : "Build today's brief"} />

      {!brief || !selected ? (
        <p className="meta">No brief yet.</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_14rem]">
          <section className="space-y-5">
            <div className="flex items-baseline justify-between">
              <h2>{dayLabel(selected.dayKey)}</h2>
              <span className="meta">
                {selected.trigger === "cron" ? "Cron" : "Built from the page"}
                {selected.emailedAt ? `, emailed to ${selected.emailedTo}` : selected.emailError ? `, not emailed (${selected.emailError})` : ""}
                {account.mode === "demo" ? `. Data as of ${brief.dateLabel} (demo time)` : ""}
              </span>
            </div>

            {brief.summary ? (
              <div className="space-y-1">
                <p className="max-w-3xl text-[1rem] leading-relaxed">{brief.summary.text}</p>
                {brief.summary.unverified.length > 0 && <p className="alert-text">Not found in the facts, check before relying on: {brief.summary.unverified.join(", ")}</p>}
                {selected.summaryModel && <p className="meta">Summary by {selected.summaryModel}, checked against the sections below.</p>}
              </div>
            ) : (
              <p className="meta">No AI summary for this brief.</p>
            )}

            <div>
              <div className="label border-b border-strong-border px-2 pb-1">Alerts ({brief.alerts.length})</div>
              {brief.alerts.length === 0 && <p className="meta px-2 py-1">None firing.</p>}
              {brief.alerts.map((a) => (
                <div key={a.rule} className="alert-row px-2 py-1.5">
                  <span className="font-medium">{a.name}</span> <span className="num">{a.valueLabel}</span>
                  <div className="meta">{a.summary}</div>
                </div>
              ))}
            </div>

            <div>
              <CardList title="Dispute deadlines" cards={brief.disputes} />
              {brief.disputes.length === 0 && <p className="meta px-2 py-1">No disputes need a response.</p>}
            </div>

            <div>
              <CardList title="Failed invoices" cards={brief.invoices} />
              {brief.invoices.length === 0 && <p className="meta px-2 py-1">No failed invoices.</p>}
            </div>

            <div>
              <div className="label border-b border-strong-border px-2 pb-1">MRR</div>
              <table className="data-table">
                <tbody>
                  {(
                    [
                      ["Now", `${brief.mrr.now} from ${brief.mrr.liveCount} subscriptions, ${brief.mrr.pastDueCount} past due`],
                      ["30 days ago", brief.mrr.start],
                      ["Net change", `${brief.mrr.net} (${brief.mrr.newMrr} new, ${brief.mrr.churnedMrr} churned)`],
                    ] as const
                  ).map(([label, value]) => (
                    <tr key={label}>
                      <td className="label w-40 normal-case tracking-normal">{label}</td>
                      <td>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {brief.items.length > 0 && (
              <div>
                <div className="label border-b border-strong-border px-2 pb-1">From your rules</div>
                {brief.items.map((item, i) => (
                  <div key={i} className="border-b px-2 py-1.5">
                    <span className="font-medium">{item.ruleName}</span> <span className="meta">{item.message}</span>
                  </div>
                ))}
              </div>
            )}

            <details className="meta">
              <summary className="cursor-pointer select-none">Sources ({brief.sources.length} Stripe objects)</summary>
              <p className="stripe-id mt-1 break-all pl-3">{brief.sources.join("  ")}</p>
            </details>
          </section>

          <aside>
            <div className="label border-b border-strong-border pb-1">Past briefs</div>
            <ul>
              {rows.map((r) => (
                <li key={r.id} className={`border-b py-1 ${r.id === selected.id ? "font-medium" : ""}`}>
                  <a href={`/briefs?day=${r.dayKey}`} className="hover:underline">
                    {dayLabel(r.dayKey)}
                  </a>
                  <span className="meta"> {(r.content as Brief).alerts.length} alerts, {(r.content as Brief).disputes.length} due</span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
    </div>
  );
}
