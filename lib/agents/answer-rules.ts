import type { Sources } from "@/lib/agents/sources";
import type { Card, NextAction, PageName } from "@/lib/cards/types";
import { leadParagraph } from "./present";
import { stripeIdsIn } from "@/lib/tools/format";

export { leadParagraph };

// Deterministic checks for the answer format rules in lib/agents/rules.ts. Used by the format evals and as the
// quality gate before a demo answer is cached (lib/demo/answer-cache.ts).

export type CapturedAnswer = {
  text: string;
  cards: Card[];
  nextAction: NextAction | null;
  sources: Sources | null;
  tools: string[];
};

export type FormatExpectations = {
  cards?: Card["kind"];
  page?: PageName;
  dueLabel?: boolean;
  mustMention?: string[];
  forbidden?: string[];
};

export type RuleResult = { rule: string; pass: boolean; detail?: string };

const GENERIC = [
  /let me know/i,
  /hope (this|that) helps/i,
  /feel free/i,
  /if you have any (other|more|further) questions/i,
  /happy to help/i,
  /keep an eye on/i,
  /best practices?/i,
];

export function countSentences(paragraph: string): number {
  const normalized = paragraph.replace(/\s+/g, " ").trim();
  if (!normalized) return 0;
  return normalized.split(/(?<=[.!?])\s+(?=[A-Z$0-9])/).filter((s) => s.trim()).length;
}

export function markdownTables(text: string): { rows: number; columns: number }[] {
  const tables: { rows: number; columns: number }[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i]!;
    const divider = lines[i + 1]!;
    if (!header.trim().startsWith("|") || !/^\s*\|?\s*:?-{2,}/.test(divider)) continue;
    const columns = header.split("|").filter((cell) => cell.trim() !== "").length;
    let rows = 0;
    let j = i + 2;
    while (j < lines.length && lines[j]!.trim().startsWith("|")) {
      rows++;
      j++;
    }
    tables.push({ rows, columns });
    i = j;
  }
  return tables;
}

export function boldCount(text: string): number {
  return (text.match(/\*\*[^*\n]+\*\*/g) ?? []).length;
}

export function checkAnswerRules(answer: CapturedAnswer, expect: FormatExpectations = {}): RuleResult[] {
  const results: RuleResult[] = [];
  const add = (rule: string, pass: boolean, detail?: string) => results.push({ rule, pass, ...(pass ? {} : { detail }) });

  const lead = leadParagraph(answer.text);
  const sentences = countSentences(lead);
  add("lead_one_or_two_sentences", sentences >= 1 && sentences <= 2, `lead has ${sentences} sentences: "${lead.slice(0, 160)}"`);

  const visibleCardText = answer.cards.flatMap((c) => [c.title, c.amount, c.status, c.action.label, ...c.details]).join(" ");
  const bodyIds = stripeIdsIn(`${answer.text} ${visibleCardText} ${answer.nextAction?.text ?? ""}`);
  add("no_ids_in_body", bodyIds.length === 0, `IDs in body: ${bodyIds.join(", ")}`);

  const isoDates = answer.text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  add("human_dates", isoDates.length === 0, `ISO dates in body: ${isoDates.join(", ")}`);

  if (expect.dueLabel) {
    const pattern = /due [A-Z][a-z]{2} \d{1,2}, (in \d+ days|today|tomorrow)/;
    const found = pattern.test(answer.text) || answer.cards.some((c) => c.kind === "dispute" && pattern.test(c.due));
    add("deadline_label", found, "no 'due Sep 25, in 9 days' style deadline");
  }

  const tables = markdownTables(answer.text);
  const badTable = tables.find((t) => t.rows < 3 || t.columns > 4);
  add("tables_3_rows_4_columns", !badTable, badTable ? `table with ${badTable.rows} rows and ${badTable.columns} columns` : undefined);

  // snake_case words are Stripe codes like insufficient_funds; rule 3 asks for the plain reason.
  const codes = answer.text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];
  add("no_raw_codes", codes.length === 0, `raw codes in body: ${[...new Set(codes)].join(", ")}`);

  const bold = boldCount(answer.text);
  add("bold_at_most_once", bold <= 1, `${bold} bold spans`);

  const generic = GENERIC.find((pattern) => pattern.test(answer.text));
  add("no_generic_advice", !generic, `matched ${generic}`);

  add("next_action", Boolean(answer.nextAction?.text), "finish_answer was not called");
  if (expect.page) {
    add(
      "next_action_page_button",
      answer.nextAction?.page === expect.page && Boolean(answer.nextAction?.button),
      `expected page ${expect.page}, got ${answer.nextAction?.page ?? "none"}`,
    );
  }

  if (answer.cards.length > 0) {
    const listed = answer.text.split("\n").filter((line) => /^\s*([-*]\s|\d+\.\s|\|)/.test(line)).length;
    add("cards_not_repeated_in_text", listed === 0, `${listed} list or table lines repeat what the cards show`);
  }

  if (expect.cards) {
    const ok = answer.cards.length > 0 && answer.cards.every((c) => c.kind === expect.cards) && tables.length === 0;
    add("structured_cards", ok, `cards: ${answer.cards.length} (${[...new Set(answer.cards.map((c) => c.kind))].join(",")}), tables: ${tables.length}`);
  }

  add("sources_verified", Boolean(answer.sources) && answer.sources!.unverified.length === 0, `unverified: ${answer.sources?.unverified.join(", ")}`);

  for (const fact of expect.mustMention ?? []) {
    const normalize = (value: string) => value.toLowerCase().replace(/\s+%/g, "%").replace(/[\u2010-\u2011]/g, "-");
    add(`mentions:${fact}`, normalize(answer.text).includes(normalize(fact)), `missing "${fact}"`);
  }
  for (const phrase of expect.forbidden ?? []) {
    add(`forbidden:${phrase}`, !new RegExp(`\\b${phrase}\\b`, "i").test(answer.text), `contains "${phrase}"`);
  }
  return results;
}
