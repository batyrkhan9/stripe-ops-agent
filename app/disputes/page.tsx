import Link from "next/link";
import { ProposalButtons } from "@/components/actions/proposal-buttons";
import { CardList } from "@/components/cards/card-list";
import { EvidenceForm } from "@/components/disputes/evidence-form";
import { listProposals } from "@/lib/actions/store";
import { evidenceFacts } from "@/lib/agents/disputes/evidence";
import { loadOpenDisputes } from "@/lib/cards/load";
import { getDb } from "@/lib/db";
import { latestDraft } from "@/lib/db/drafts";
import { dateLabel, moneyLabel, titleCase } from "@/lib/format/human";
import { getRequestContext } from "@/lib/stripe/request-context";
import { effectiveTime } from "@/lib/tools/format";
import { collectByDate } from "@/lib/tools/types";

export const dynamic = "force-dynamic";

export default async function DisputesPage({ searchParams }: { searchParams: Promise<{ dispute?: string }> }) {
  const { dispute: selectedId } = await searchParams;
  const { account, accountId, now } = await getRequestContext();
  const stripe = account.stripe;
  const db = getDb();
  const [open, recent] = await Promise.all([
    loadOpenDisputes(stripe, now),
    collectByDate(stripe.disputes.list({ limit: 100, expand: ["data.charge.customer"] }), { now, days: 90, where: (d) => !/needs_response/.test(d.status) }),
  ]);

  const selected = selectedId && /^du_[A-Za-z0-9]{6,}$/.test(selectedId) ? await stripe.disputes.retrieve(selectedId, { expand: ["charge.customer"] }).catch(() => null) : null;
  let detail: React.ReactNode = null;
  if (selected) {
    const charge = typeof selected.charge === "string" ? null : selected.charge;
    const customerId = typeof charge?.customer === "string" ? charge.customer : charge?.customer?.id;
    const [history, draft, proposals] = await Promise.all([
      customerId ? stripe.charges.list({ customer: customerId, limit: 100 }).then((r) => r.data) : Promise.resolve([]),
      latestDraft(db, { accountId, kind: "dispute_evidence", targetId: selected.id }),
      listProposals(db, { accountId, connectionId: account.connection?.id ?? null }),
    ]);
    const facts = evidenceFacts(selected, now, history);
    const pending = proposals.filter((p) => p.status === "proposed" && p.tool === "submit_dispute_evidence" && p.targetIds.includes(selected.id));
    const needsResponse = /needs_response/.test(selected.status);
    const rows: [string, string | null][] = [
      ["Customer", [facts.customerName, facts.customerEmail].filter(Boolean).join(", ")],
      ["Amount", facts.amount],
      ["Reason", facts.reasonLabel],
      ["Status", titleCase(selected.status)],
      ["Deadline", facts.due],
      ["Charge", [facts.chargeDate, facts.chargeDescription].filter(Boolean).join(", ")],
      ["Shipping", facts.trackingNumber ? `${facts.carrier ?? "Carrier unknown"}, tracking ${facts.trackingNumber}` : null],
      ["Card", [facts.card, ...facts.checks].filter(Boolean).join(", ")],
      ["Customer history", facts.customerHistory],
      ["Refunded", facts.refunded],
    ];
    const content = draft?.content as { fields?: Record<string, string> } | undefined;
    detail = (
      <section className="space-y-3 border-t border-strong-border pt-3" id="detail">
        <div className="flex items-baseline justify-between">
          <h2>
            {facts.customerName ?? "Customer"}, {facts.amount} {facts.reasonLabel.toLowerCase()}
          </h2>
          <Link className="meta underline" href="/disputes">
            Close
          </Link>
        </div>
        <table className="data-table">
          <tbody>
            {rows
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <tr key={label}>
                  <td className="label w-48 normal-case tracking-normal">{label}</td>
                  <td className={label === "Deadline" && needsResponse ? "font-medium" : ""}>{value}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {pending.map((p) => (
          <div key={p.id} className="alert-row grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 px-2 py-2">
            <div>
              <div className="font-medium">{p.summary}</div>
              <div className="meta">{p.details.join(" · ")}</div>
            </div>
            <ProposalButtons id={p.id} confirmLabel={p.confirmLabel} demo={account.mode === "demo" || p.mode === "demo"} />
          </div>
        ))}
        {needsResponse ? (
          <EvidenceForm
            disputeId={selected.id}
            fields={content?.fields ?? null}
            draftLabel={draft ? `Draft from ${dateLabel(Math.floor(draft.createdAt.getTime() / 1000))}${draft.modelId ? ` by ${draft.modelId}` : ""}` : null}
          />
        ) : (
          <p className="meta">This dispute no longer accepts evidence.</p>
        )}
      </section>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="page-header">
        <h1>Disputes</h1>
        <span className="meta">Draft evidence from Stripe data, edit it, and submit only after you confirm.</span>
      </div>

      <section>
        <CardList title="Needing a response" cards={open.map((d) => d.card)} />
        {open.length === 0 && <p className="meta">No disputes need a response.</p>}
      </section>

      {detail}

      {recent.length > 0 && (
        <section className="space-y-1">
          <h2>Other disputes, last 90 days</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Opened</th>
                <th>Customer</th>
                <th className="num">Amount</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((d) => {
                const charge = typeof d.charge === "string" ? null : d.charge;
                const customer = charge?.customer && typeof charge.customer !== "string" && !charge.customer.deleted ? charge.customer : null;
                return (
                  <tr key={d.id}>
                    <td>{dateLabel(effectiveTime(d), now)}</td>
                    <td>
                      <Link className="underline" href={`/disputes?dispute=${d.id}#detail`}>
                        {customer?.name ?? customer?.email ?? "Unknown"}
                      </Link>
                    </td>
                    <td className="num">{moneyLabel(d.amount, d.currency)}</td>
                    <td>{titleCase(d.reason)}</td>
                    <td>{titleCase(d.status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
