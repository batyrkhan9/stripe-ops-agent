import { ProposalButtons } from "@/components/actions/proposal-buttons";
import { listAudit, listProposals } from "@/lib/actions/store";
import { getDb } from "@/lib/db";
import { getRequestContext } from "@/lib/stripe/request-context";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const timeLabel = (date: Date) =>
  `${date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}, ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;

function auditOutcome(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as Record<string, unknown>;
  if (typeof r.status === "string" && typeof r.summary === "string") return `${r.status}: ${r.summary}`;
  if (r.status === "refused" || r.status === "rejected") return `${r.status}: ${String(r.message ?? "")}`;
  if (r.refused) return `refused: ${String(r.refused)}`;
  if (r.executing) return "executing";
  if (r.error) return `error: ${String(r.message ?? r.error)}`;
  if (typeof r.id === "string" && typeof r.status === "string") return `executed: ${r.status}`;
  return "ok";
}

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ proposal?: string; page?: string }> }) {
  const params = await searchParams;
  const { account, accountId } = await getRequestContext();
  const db = getDb();
  const page = Math.max(0, Number.parseInt(params.page ?? "0", 10) || 0);
  const scope = { accountId, connectionId: account.connection?.id ?? null };
  const [proposals, audit] = await Promise.all([listProposals(db, scope), listAudit(db, accountId, { limit: PAGE_SIZE, offset: page * PAGE_SIZE })]);
  const pending = proposals.filter((p) => p.status === "proposed");
  const decided = proposals.filter((p) => p.status !== "proposed");
  const demo = account.mode === "demo";
  const writable = account.mode === "connected" && account.canWrite;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="page-header">
        <h1>Actions</h1>
        <span className="meta">Agents propose changes. Nothing changes in Stripe until you confirm.</span>
      </div>

      {!demo && !writable && (
        <p className="alert-row px-2 py-1.5">This key is read-only. Grant Write on refunds, coupons, subscriptions, or disputes and reconnect in Settings to confirm actions.</p>
      )}

      <section className="space-y-1">
        <div className="label border-b border-strong-border px-2 pb-1">Waiting for confirmation ({pending.length})</div>
        {pending.length === 0 && <p className="meta px-2">No pending proposals. Ask for a refund, coupon, pause, or cancellation on Ask.</p>}
        {pending.map((p) => (
          <div
            key={p.id}
            id={p.id}
            className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 border-b py-2 pr-1 pl-2 ${p.id === params.proposal ? "alert-row" : "border-l-2 border-l-transparent"}`}
          >
            <div className="min-w-0 space-y-0.5">
              <div className="font-medium">{p.summary}</div>
              <div className="meta">{p.details.join(" · ")}</div>
              <div className="meta">
                Proposed by {p.agent} agent, {timeLabel(p.createdAt)}
              </div>
            </div>
            <ProposalButtons id={p.id} confirmLabel={p.confirmLabel} demo={p.mode === "demo" || demo} />
          </div>
        ))}
      </section>

      {decided.length > 0 && (
        <section className="space-y-1">
          <h2>Decided</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Status</th>
                <th>Result</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {decided.map((p) => (
                <tr key={p.id}>
                  <td>{p.summary}</td>
                  <td className={p.status === "failed" ? "alert-text" : ""}>{p.status}</td>
                  <td className="meta">{p.error ?? (p.result && typeof p.result === "object" ? <span className="stripe-id">{String((p.result as { id?: string }).id ?? "")}</span> : "")}</td>
                  <td className="meta whitespace-nowrap">{p.decidedAt ? timeLabel(p.decidedAt) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h2>Audit log</h2>
          <span className="meta">Every tool call by every agent, and every confirm, newest first</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Agent</th>
              <th>Tool</th>
              <th>Stripe objects</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((row) => (
              <tr key={row.id}>
                <td className="meta whitespace-nowrap">{timeLabel(row.createdAt)}</td>
                <td>{row.agent}</td>
                <td className="font-medium">{row.tool}</td>
                <td className="stripe-id max-w-56 truncate" title={row.stripeIds.join(" ")}>
                  {row.stripeIds.length ? `${row.stripeIds.slice(0, 2).join(" ")}${row.stripeIds.length > 2 ? ` +${row.stripeIds.length - 2}` : ""}` : ""}
                </td>
                <td className="meta max-w-80 truncate">{auditOutcome(row.result)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-between">
          {page > 0 ? <a className="underline" href={`/actions?page=${page - 1}`}>Newer</a> : <span />}
          {audit.length === PAGE_SIZE && <a className="underline" href={`/actions?page=${page + 1}`}>Older</a>}
        </div>
      </section>
    </div>
  );
}
