import type { Brief } from "./build";

// Plain text and simple HTML renderings of a brief, and delivery through Resend's REST API (free tier). No SDK: one
// POST with the API key in a header. When RESEND_API_KEY or the addresses are missing, sending is skipped and the
// reason is stored with the brief instead of failing the cron.
export function briefSubject(brief: Brief): string {
  const urgent = [
    brief.alerts.length ? `${brief.alerts.length} alert${brief.alerts.length === 1 ? "" : "s"}` : "",
    brief.disputes.length ? `${brief.disputes.length} dispute deadline${brief.disputes.length === 1 ? "" : "s"}` : "",
    brief.invoices.length ? `${brief.invoices.length} failed invoice${brief.invoices.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `Morning brief, ${brief.dateLabel}: ${urgent.length ? urgent.join(", ") : "nothing urgent"}`;
}

export function renderBriefText(brief: Brief, appUrl: string): string {
  const lines: string[] = [`Morning brief for ${brief.dateLabel}`, ""];
  if (brief.summary) lines.push(brief.summary.text, "");
  lines.push("Alerts");
  lines.push(...(brief.alerts.length ? brief.alerts.map((a) => `- ${a.name}: ${a.valueLabel}. ${a.summary}`) : ["- None firing"]), "");
  lines.push("Dispute deadlines");
  lines.push(...(brief.disputes.length ? brief.disputes.map((d) => `- ${d.title}, ${d.amount}, ${d.reason}: ${d.due}`) : ["- None"]), "");
  lines.push("Failed invoices");
  lines.push(...(brief.invoices.length ? brief.invoices.map((i) => `- ${i.title} owes ${i.amount}: ${i.failure}. ${i.retry}`) : ["- None"]), "");
  lines.push("MRR", `- ${brief.mrr.now} now, ${brief.mrr.start} 30 days ago, net ${brief.mrr.net} (${brief.mrr.newMrr} new, ${brief.mrr.churnedMrr} churned)`, "");
  if (brief.items.length) lines.push("From your rules", ...brief.items.map((i) => `- ${i.ruleName}: ${i.message}`), "");
  lines.push(`Open the app: ${appUrl}/briefs`);
  return lines.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderBriefHtml(brief: Brief, appUrl: string): string {
  const section = (title: string, rows: string[]) =>
    `<h3 style="margin:16px 0 4px;font-size:14px">${esc(title)}</h3>${rows.length ? `<ul style="margin:0;padding-left:18px">${rows.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : `<p style="margin:0;color:#666">None</p>`}`;
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#111;max-width:640px">
<h2 style="font-size:16px;margin:0 0 8px">Morning brief for ${esc(brief.dateLabel)}</h2>
${brief.summary ? `<p style="margin:0 0 8px">${esc(brief.summary.text)}</p>` : ""}
${section("Alerts", brief.alerts.map((a) => `${a.name}: ${a.valueLabel}. ${a.summary}`))}
${section("Dispute deadlines", brief.disputes.map((d) => `${d.title}, ${d.amount}, ${d.reason}: ${d.due}`))}
${section("Failed invoices", brief.invoices.map((i) => `${i.title} owes ${i.amount}: ${i.failure}. ${i.retry}`))}
${section("MRR", [`${brief.mrr.now} now, ${brief.mrr.start} 30 days ago, net ${brief.mrr.net} (${brief.mrr.newMrr} new, ${brief.mrr.churnedMrr} churned)`])}
${brief.items.length ? section("From your rules", brief.items.map((i) => `${i.ruleName}: ${i.message}`)) : ""}
<p style="margin:16px 0 0"><a href="${esc(appUrl)}/briefs">Open the app</a></p>
</div>`;
}

export type EmailResult = { sent: true; id: string; to: string } | { sent: false; reason: string };

export async function sendBriefEmail(
  brief: Brief,
  env: { RESEND_API_KEY?: string; BRIEF_FROM_EMAIL?: string; BRIEF_TO_EMAIL?: string; APP_URL?: string },
  fetchFn: typeof fetch = fetch,
): Promise<EmailResult> {
  if (!env.RESEND_API_KEY) return { sent: false, reason: "RESEND_API_KEY not set" };
  if (!env.BRIEF_FROM_EMAIL || !env.BRIEF_TO_EMAIL) return { sent: false, reason: "BRIEF_FROM_EMAIL or BRIEF_TO_EMAIL not set" };
  const appUrl = env.APP_URL ?? "";
  const response = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.BRIEF_FROM_EMAIL, to: [env.BRIEF_TO_EMAIL], subject: briefSubject(brief), text: renderBriefText(brief, appUrl), html: renderBriefHtml(brief, appUrl) }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { sent: false, reason: `Resend ${response.status}: ${body.replace(/re_[A-Za-z0-9_]+/g, "[redacted]").slice(0, 200)}` };
  }
  const data = (await response.json()) as { id?: string };
  return { sent: true, id: data.id ?? "unknown", to: env.BRIEF_TO_EMAIL };
}
