import Link from "next/link";
import { CardList } from "@/components/cards/card-list";
import { EmailDraft } from "@/components/recovery/email-draft";
import { recoveryFacts, retrySchedule } from "@/lib/agents/recovery/plan";
import { loadFailedInvoices, loadInvoiceDetail } from "@/lib/cards/load";
import { getDb } from "@/lib/db";
import { latestDraft } from "@/lib/db/drafts";
import { dateLabel, moneyLabel } from "@/lib/format/human";
import { explainDecline } from "@/lib/stripe/declines";
import { getRequestContext } from "@/lib/stripe/request-context";
import { collectByDate } from "@/lib/tools/types";

export const dynamic = "force-dynamic";

const RETRY_TEXT = { soon: "Retry soon", later: "Retry after a few days", no: "Do not retry" } as const;

export default async function RecoveryPage({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  const { invoice: selectedId } = await searchParams;
  const { account, accountId, now } = await getRequestContext();
  const stripe = account.stripe;
  const [invoices, failedCharges] = await Promise.all([
    loadFailedInvoices(stripe, now),
    collectByDate(stripe.charges.list({ limit: 100 }), { now, days: 30, where: (c) => c.status === "failed" }),
  ]);

  const byReason = new Map<string, { count: number; minor: number; currency: string }>();
  for (const charge of failedCharges) {
    const code = charge.outcome?.reason ?? charge.failure_code ?? "unknown";
    const row = byReason.get(code) ?? { count: 0, minor: 0, currency: charge.currency };
    byReason.set(code, { ...row, count: row.count + 1, minor: row.minor + charge.amount });
  }
  const reasons = [...byReason.entries()].sort((a, b) => b[1].count - a[1].count);

  let detail: React.ReactNode = null;
  if (selectedId && /^in_[A-Za-z0-9]{6,}$/.test(selectedId)) {
    const loaded = await loadInvoiceDetail(stripe, selectedId, now).catch(() => null);
    if (loaded) {
      const facts = recoveryFacts(loaded.invoice, loaded.declineCode, loaded.lastAttempt);
      const schedule = retrySchedule(facts, now);
      const draft = await latestDraft(getDb(), { accountId, kind: "recovery_plan", targetId: selectedId });
      const email = (draft?.content as { email?: { subject: string; body: string } } | undefined)?.email ?? null;
      detail = (
        <section className="space-y-3 border-t border-strong-border pt-3" id="detail">
          <div className="flex items-baseline justify-between">
            <h2>
              {facts.customerName ?? "Customer"}, {facts.amount} unpaid
            </h2>
            <Link className="meta underline" href="/recovery">
              Close
            </Link>
          </div>
          <table className="data-table">
            <tbody>
              {(
                [
                  ["Customer", [facts.customerName, facts.customerEmail].filter(Boolean).join(", ")],
                  ["For", facts.product],
                  ["Why it failed", facts.decline.meaning],
                  ["Customer can", facts.decline.customerAction],
                  ["Attempts", `${facts.attempts}${facts.lastAttempt ? `, last ${dateLabel(facts.lastAttempt, now)}` : ""}`],
                  ["Stripe's next retry", facts.stripeNextAttempt ? dateLabel(facts.stripeNextAttempt, now) : "None scheduled"],
                ] as const
              ).map(([label, value]) => (
                <tr key={label}>
                  <td className="label w-48 normal-case tracking-normal">{label}</td>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="space-y-1">
            <h2>Retry plan</h2>
            <table className="data-table">
              <tbody>
                {schedule.map((step) => (
                  <tr key={step.at + step.action}>
                    <td className="num w-24 whitespace-nowrap">{step.label}</td>
                    <td>{step.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="meta">
              Built from the decline type: {RETRY_TEXT[facts.decline.retry].toLowerCase()}. If Stripe Smart Retries is on, it retries on its own schedule; adjust this plan to match.
            </p>
          </div>

          <div className="space-y-1">
            <h2>Customer email</h2>
            <EmailDraft
              invoiceId={selectedId}
              email={email}
              draftLabel={draft ? `Draft from ${dateLabel(Math.floor(draft.createdAt.getTime() / 1000))}${draft.modelId ? ` by ${draft.modelId}` : ""}` : null}
            />
          </div>
        </section>
      );
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="page-header">
        <h1>Recovery</h1>
        <span className="meta">Failed and past-due invoices, why they failed, a retry plan, and a customer email draft.</span>
      </div>

      <section>
        <CardList title="Failed invoices" cards={invoices.map((i) => ({ ...i.card, action: { ...i.card.action, href: `${i.card.action.href}#detail` } }))} />
        {invoices.length === 0 && <p className="meta">No failed invoices.</p>}
      </section>

      {detail}

      <section className="space-y-1">
        <h2>Why payments failed, last 30 days</h2>
        {reasons.length === 0 ? (
          <p className="meta">No failed payments.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Reason</th>
                <th className="num">Payments</th>
                <th className="num">Amount</th>
                <th>Retry</th>
                <th>Customer can</th>
              </tr>
            </thead>
            <tbody>
              {reasons.map(([code, row]) => {
                const decline = explainDecline(code);
                return (
                  <tr key={code}>
                    <td>{decline.meaning}</td>
                    <td className="num">{row.count}</td>
                    <td className="num">{moneyLabel(row.minor, row.currency)}</td>
                    <td>{RETRY_TEXT[decline.retry]}</td>
                    <td>{decline.customerAction}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
