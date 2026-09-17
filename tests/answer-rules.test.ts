import { describe, expect, it } from "vitest";
import { boldCount, checkAnswerRules, countSentences, leadParagraph, markdownTables, type CapturedAnswer } from "@/lib/agents/answer-rules";
import type { DisputeCard } from "@/lib/cards/types";

const card: DisputeCard = {
  kind: "dispute",
  id: "du_1UGX7p3FpwYTqedqcy6JowYK",
  title: "Ethan Nguyen",
  amount: "$65.00",
  reason: "Fraudulent",
  status: "Needs response",
  due: "due Sep 25, in 9 days",
  urgent: false,
  details: ["Order KC-10299"],
  action: { label: "Draft evidence", href: "/disputes?dispute=du_1UGX7p3FpwYTqedqcy6JowYK" },
};

const good: CapturedAnswer = {
  text: "Two disputes need a response, both due Sep 25, in 9 days.",
  cards: [card],
  nextAction: { text: "Draft evidence for Ethan Nguyen first.", page: "disputes", button: { label: "Open disputes", href: "/disputes" } },
  sources: { cited: [card.id], unverified: [], tools: ["list_disputes", "show_disputes"] },
  tools: ["list_disputes", "show_disputes", "finish_answer"],
};

const failing = (answer: CapturedAnswer, expect = {}) =>
  checkAnswerRules(answer, expect).filter((r) => !r.pass).map((r) => r.rule);

describe("answer rule helpers", () => {
  it("finds the lead paragraph and counts sentences without splitting amounts or rates", () => {
    expect(leadParagraph("| a | b |\n|---|---|\n\nThe rate is 0.65%. It is below $1.00 limits.\n\nMore.")).toBe("");
    expect(leadParagraph("The rate is 0.65%. It is fine.\n\nDetails.")).toBe("The rate is 0.65%. It is fine.");
    expect(leadParagraph("You had 19 failures.  \n- Nine were funds.\n- Ten were generic.")).toBe("You had 19 failures.");
    expect(countSentences("The rate is 0.65%. It is below the $65.00 mark.")).toBe(2);
    expect(countSentences("One. Two. Three.")).toBe(3);
  });

  it("measures tables and bold", () => {
    expect(markdownTables("| A | B | C | D | E |\n|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 |")).toEqual([{ rows: 1, columns: 5 }]);
    expect(boldCount("**one** and **two**")).toBe(2);
  });
});

describe("checkAnswerRules", () => {
  it("passes a well-formed structured answer", () => {
    expect(failing(good, { cards: "dispute", page: "disputes", dueLabel: true })).toEqual([]);
  });

  it("catches IDs in the body, ISO dates, and a long lead", () => {
    const answer = { ...good, text: "Dispute du_1UGX7p3FpwYTqedqcy6JowYK is open. It is due 2026-09-25. Act now. Please." };
    expect(failing(answer)).toEqual(expect.arrayContaining(["lead_one_or_two_sentences", "no_ids_in_body", "human_dates"]));
  });

  it("catches small or wide tables, extra bold, and generic closing lines", () => {
    const answer = {
      ...good,
      text: "**Two** failures.\n\n| A | B | C | D | E |\n|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 |\n\n**Note** and let me know if you need more.",
    };
    expect(failing(answer)).toEqual(expect.arrayContaining(["tables_3_rows_4_columns", "bold_at_most_once", "no_generic_advice"]));
  });

  it("requires a next action with the expected page button, cards instead of tables, and verified sources", () => {
    const answer: CapturedAnswer = { ...good, cards: [], nextAction: null, sources: { cited: [], unverified: ["du_fake"], tools: [] } };
    expect(failing(answer, { cards: "dispute", page: "disputes" })).toEqual(
      expect.arrayContaining(["next_action", "next_action_page_button", "structured_cards", "sources_verified"]),
    );
  });

  it("flags lists that repeat the cards", () => {
    const answer = { ...good, text: "Two disputes need a response.\n- Ethan Nguyen $65.00\n- Camila Torres $28.00" };
    expect(failing(answer)).toContain("cards_not_repeated_in_text");
  });

  it("checks required and forbidden phrases", () => {
    const answer = { ...good, text: "The order has been refunded." };
    expect(failing(answer, { mustMention: ["0.65%"], forbidden: ["has been refunded"] })).toEqual(
      expect.arrayContaining(["mentions:0.65%", "forbidden:has been refunded"]),
    );
  });
});

describe("visibleAnswerText", () => {
  it("shows only the lead when cards carry the details, and keeps bold once", async () => {
    const { visibleAnswerText } = await import("@/lib/agents/present");
    const text = "You have **two** disputes due Sep 25.\n- **Ethan** $65.00\n- Camila $28.00";
    expect(visibleAnswerText(text, true)).toBe("You have **two** disputes due Sep 25.");
    expect(visibleAnswerText(text, false)).toBe("You have **two** disputes due Sep 25.\n- Ethan $65.00\n- Camila $28.00");
    expect(visibleAnswerText("You need to respond to two open disputes:\n\n- Ethan", true)).toBe("You need to respond to two open disputes.");
  });
});
