import Link from "next/link";
import { CardList } from "@/components/cards/card-list";
import { alertCard, checkAlerts } from "@/lib/alerts/check";
import { loadFailedInvoices, loadOpenDisputes } from "@/lib/cards/load";
import { getDb } from "@/lib/db";
import { dateLabel } from "@/lib/format/human";
import { getRequestContext } from "@/lib/stripe/request-context";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { account, accountId, now } = await getRequestContext();
  const [alerts, disputes, invoices] = await Promise.all([
    checkAlerts({ db: getDb(), stripe: account.stripe, accountId, now, trigger: "page_load" }),
    loadOpenDisputes(account.stripe, now),
    loadFailedInvoices(account.stripe, now, 10),
  ]);
  const firing = alerts.filter((a) => a.firing);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="page-header">
        <h1>Dashboard</h1>
        <span className="meta">
          {account.mode === "demo" ? "Demo account, frozen at " : "As of "}
          {dateLabel(now)}
        </span>
      </div>

      <section>
        <CardList title="Alerts" cards={firing.map(alertCard)} />
        {firing.length === 0 && <p className="meta">No alert rules are firing.</p>}
      </section>

      <section>
        <CardList title="Disputes needing a response" cards={disputes.map((d) => d.card)} />
        {disputes.length === 0 && <p className="meta">No disputes need a response.</p>}
      </section>

      <section>
        <CardList title="Failed invoices" cards={invoices.map((i) => i.card)} />
        {invoices.length === 0 && <p className="meta">No failed invoices.</p>}
      </section>

      <p className="meta">
        Ask a question about this account on <Link className="underline" href="/chat">Ask</Link>.
      </p>
    </div>
  );
}
