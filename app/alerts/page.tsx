import { checkAlerts } from "@/lib/alerts/check";
import { THRESHOLDS } from "@/lib/alerts/rules";
import { alertHistory } from "@/lib/alerts/store";
import { getDb } from "@/lib/db";
import { dateLabel } from "@/lib/format/human";
import { getRequestContext } from "@/lib/stripe/request-context";

export const dynamic = "force-dynamic";

const RULE_NAMES: Record<string, string> = { chargeback_rate: "Chargeback rate", refund_spike: "Refund spike", decline_rate: "Decline rate" };

export default async function AlertsPage() {
  const { account, accountId, now } = await getRequestContext();
  const db = getDb();
  const [results, history] = await Promise.all([
    checkAlerts({ db, stripe: account.stripe, accountId, now, trigger: "page_load" }),
    alertHistory(db, accountId),
  ]);
  const firing = results.filter((r) => r.firing).length;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="page-header">
        <h1>Alerts</h1>
        <span className="meta">
          {firing ? `${firing} of ${results.length} rules firing` : "No rules firing"}. Checked {dateLabel(now)}
          {account.mode === "demo" ? " (demo time)" : ""}, on page load and on Stripe webhooks.
        </span>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Rule</th>
            <th className="num">Value</th>
            <th>Window</th>
            <th>Threshold</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.rule} id={r.rule} className={r.firing ? "alert-row" : ""}>
              <td>
                <div className="font-medium">{r.name}</div>
                <div className="meta">{r.summary}</div>
              </td>
              <td className="num font-medium whitespace-nowrap">{r.valueLabel}</td>
              <td className="whitespace-nowrap">{r.windowLabel}</td>
              <td className="meta">{r.thresholdLabel}</td>
              <td className={r.firing ? "alert-text" : "meta"}>{r.severity === "critical" ? "Critical" : r.firing ? "Warning" : "OK"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="meta max-w-3xl">
        Stripe starts monitoring accounts whose dispute rate reaches {(THRESHOLDS.chargebackStripe * 100).toFixed(2)}%, which can lead to reserves or
        closure. Keeping disputes and refunds low is the one lever a merchant controls, so the warning fires early at{" "}
        {(THRESHOLDS.chargebackWarn * 100).toFixed(2)}%.
      </p>

      <section className="space-y-1">
        <h2>History</h2>
        {history.length === 0 ? (
          <p className="meta">No alert has fired for this account yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Rule</th>
                <th className="num">Value</th>
                <th>Severity</th>
                <th>First seen by</th>
                <th className="num">Checks</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id}>
                  <td>{dateLabel(Date.parse(row.dayKey) / 1000, now)}</td>
                  <td>{RULE_NAMES[row.rule] ?? row.rule}</td>
                  <td className="num">{row.valueLabel}</td>
                  <td>{row.severity === "critical" ? "Critical" : "Warning"}</td>
                  <td>{row.firstTrigger === "page_load" ? "Page load" : row.firstTrigger === "webhook" ? "Webhook" : "Cron"}</td>
                  <td className="num">{row.evaluations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
