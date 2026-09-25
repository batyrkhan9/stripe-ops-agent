import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { briefFacts, dayKeyFor, disputeDeadlines, type Brief } from "@/lib/brief/build";
import { isAuthorizedCron } from "@/lib/brief/cron-auth";
import { briefSubject, renderBriefHtml, renderBriefText, sendBriefEmail } from "@/lib/brief/email";
import type { DisputeCard } from "@/lib/cards/types";

const NOW = 1_789_000_000;
const DAY = 86_400;

const card = (id: string, title: string): DisputeCard => ({
  kind: "dispute",
  id,
  title,
  amount: "$65.00",
  reason: "Fraudulent",
  status: "Needs response",
  due: "due Sep 25, in 8 days",
  urgent: false,
  details: [],
  action: { label: "Draft evidence", href: `/disputes?dispute=${id}` },
});
const withDue = (id: string, title: string, daysFromNow: number | null) => ({
  dispute: { evidence_details: daysFromNow === null ? null : { due_by: NOW + daysFromNow * DAY } } as unknown as Stripe.Dispute,
  card: card(id, title),
});

const brief: Brief = {
  dayKey: "2026-09-24",
  now: NOW,
  dateLabel: "Sep 17",
  alerts: [{ rule: "chargeback_rate", name: "Chargeback rate", severity: "warning", valueLabel: "0.65%", summary: "2 disputes on 306 charges." }],
  disputes: [{ ...card("du_1", "Ethan Nguyen"), daysLeft: 8 }],
  invoices: [],
  mrr: { now: "$945.31", start: "$891.65", net: "+$53.66", newMrr: "+$160.66", churnedMrr: "-$107.00", liveCount: 30, pastDueCount: 5 },
  items: [{ ruleName: "Big refunds", message: "1 refund over $100 yesterday" }],
  summary: null,
  sources: ["du_1"],
};

describe("disputeDeadlines", () => {
  it("lists every open deadline, overdue first, soonest next, undated last", () => {
    const result = disputeDeadlines([withDue("a", "A", 10), withDue("b", "B", 3), withDue("c", "C", -1), withDue("d", "D", null), withDue("e", "E", 7)], NOW);
    expect(result.map((d) => [d.id, d.daysLeft])).toEqual([
      ["c", -1],
      ["b", 3],
      ["e", 7],
      ["a", 10],
      ["d", null],
    ]);
  });

  it("keys days in UTC", () => {
    expect(dayKeyFor(new Date("2026-09-24T23:59:00Z"))).toBe("2026-09-24");
  });
});

describe("brief rendering", () => {
  it("puts the urgent counts in the subject", () => {
    expect(briefSubject(brief)).toBe("Morning brief, Sep 17: 1 alert, 1 dispute deadline");
    expect(briefSubject({ ...brief, alerts: [], disputes: [] })).toBe("Morning brief, Sep 17: nothing urgent");
  });

  it("renders every section in text and html, escaping html", () => {
    const text = renderBriefText(brief, "https://example.test");
    expect(text).toContain("Chargeback rate: 0.65%");
    expect(text).toContain("Ethan Nguyen, $65.00, Fraudulent: due Sep 25, in 8 days");
    expect(text).toContain("Big refunds: 1 refund over $100 yesterday");
    expect(text).toContain("https://example.test/briefs");
    const html = renderBriefHtml({ ...brief, summary: { text: "<b>bold</b> & more", unverified: [] } }, "https://example.test");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt; &amp; more");
    expect(html).not.toContain("<b>bold</b>");
  });

  it("gives the summary model facts with the same numbers the page shows", () => {
    const facts = briefFacts(brief);
    expect(facts).toContain("Chargeback rate 0.65% (warning)");
    expect(facts).toContain("MRR: $945.31 now from 30 subscriptions (5 past due); $891.65 30 days ago; net +$53.66");
  });
});

describe("sendBriefEmail", () => {
  it("skips with a reason when Resend is not configured", async () => {
    const fetchFn = vi.fn();
    expect(await sendBriefEmail(brief, {}, fetchFn as unknown as typeof fetch)).toEqual({ sent: false, reason: "RESEND_API_KEY not set" });
    expect(await sendBriefEmail(brief, { RESEND_API_KEY: "re_x" }, fetchFn as unknown as typeof fetch)).toMatchObject({ sent: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("posts to Resend with the key in a header and reports failures without leaking the key", async () => {
    const env = { RESEND_API_KEY: "re_secret123", BRIEF_FROM_EMAIL: "brief@example.test", BRIEF_TO_EMAIL: "me@example.test", APP_URL: "https://app.test" };
    const ok = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "email_1" }) });
    expect(await sendBriefEmail(brief, env, ok as unknown as typeof fetch)).toEqual({ sent: true, id: "email_1", to: "me@example.test" });
    const [url, init] = ok.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer re_secret123" });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ to: ["me@example.test"], subject: briefSubject(brief) });
    const bad = vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "invalid key re_secret123" });
    const result = await sendBriefEmail(brief, env, bad as unknown as typeof fetch);
    expect(result).toMatchObject({ sent: false });
    expect(JSON.stringify(result)).not.toContain("re_secret123");
  });
});

describe("isAuthorizedCron", () => {
  const secret = "a-secret-that-is-long-enough";
  it("accepts only the exact bearer secret and fails closed without one", () => {
    expect(isAuthorizedCron(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorizedCron(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorizedCron(`Bearer wrong`, secret)).toBe(false);
    expect(isAuthorizedCron(null, secret)).toBe(false);
    expect(isAuthorizedCron("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer short", "short")).toBe(false);
  });
});
